/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var path = require('path');
var fs = require('fs');

var once = require('once');
var ldap = require('ldapjs');
var vasync = require('vasync');
var bunyan = require('bunyan');
var assert = require('assert-plus');
var util = require('util');
var libuuid = require('libuuid');

var ufds = require('ufds-server');
var moray = require('moray');
var replicator = require('../lib/index');

///--- Globals
var PRIMARY_BUCKET = 'test_ufds_pri';
var PRIMARY_CLOG_BUCKET = 'test_ufds_clog_pri';

var REPL_BUCKET = 'test_ufds_repl';
var REPL_CLOG_BUCKET = 'test_ufds_clog_repl';

var UFDS_SKELETON_FILE = process.env.UFDS_SKELETON_FILE ||
    path.join(__dirname, '../data/skeleton.coal.json');
var UFDS_BASE_CONFIG = process.env.UFDS_BASE_CONFIG ||
    path.join(__dirname, '../node_modules/ufds-server/etc/config.coal.json');

var LOG =  bunyan.createLogger({
    name: 'ufds-replicator-tests',
    level: process.env.LOG_LEVEL || 'warn'
});

var ufdsPrimary;
var ufdsReplica;


function baseConfig(override) {
    var config = JSON.parse(fs.readFileSync(UFDS_BASE_CONFIG, 'utf8'));
    var clear = ['ufds', 'host', 'port', 'ufds_is_master'];

    // Wipe out variables that will be provided by the tests
    clear.forEach(function (field) {
        delete config[field];
    });
    delete config.changelog.bucket;
    delete config['o=smartdc'].bucket;
    if (override && typeof (override) === 'object') {
        // override two levels deep
        Object.keys(override).forEach(function (key) {
            var val = override[key];
            if (typeof (val) === 'object') {
                Object.keys(val).forEach(function (key2) {
                    config[key][key2] = val[key2];
                });
            } else {
                config[key] = val;
            }
        });
    }
    return config;
}

function createUFDS(config, cb) {
    cb = once(cb);
    var server = ufds.createServer(config);
    server.once('morayError', function () {
        cb(new Error('could not connect to moray'));
    });
    server.init(function () {
        // Create an associated ldap client for tests
        server.removeAllListeners('morayError');
        var client = ldap.createClient({
            url: server.server.url,
            bindDN: config.rootDN,
            bindCredentials: config.rootPassword,
            log: LOG
        });
        client.once('connect', function () {
            server.CLIENT = client;
            cb(null, server);
        });
    });
}

function initializeSkeleton(client, cb) {
    var skeleton;
    try {
        skeleton = JSON.parse(fs.readFileSync(UFDS_SKELETON_FILE, 'utf8'));
    } catch (e) {
        cb(e);
    }

    vasync.forEachPipeline({
        inputs: skeleton,
        func: function (obj, callback) {
            var dn = obj.dn;
            delete obj.dn;
            client.add(dn, obj, function (err, res) {
                callback(err);
            });
        }
    }, function (err, res) {
        cb(err);
    });
}

function destroyUFDS(server, cb) {
    if (server) {
        server.CLIENT.destroy();
        server.CLIENT.on('close', server.close.bind(server));
        server.once('close', cb.bind(null, null));
    } else {
        cb();
    }
}

function cleanMoray(cb) {
    var config = baseConfig();
    config.moray.log = LOG.child({app: 'moray'});
    var client = moray.createClient(config.moray);
    client.on('error', function (err) {
        console.log(err);
    });
    client.once('connect', function () {
        vasync.forEachParallel({
            inputs: [
                PRIMARY_BUCKET,
                PRIMARY_CLOG_BUCKET,
                REPL_BUCKET,
                REPL_CLOG_BUCKET
            ],
            func: function (_, callback) {
                client.deleteBucket(_, function (err) {
                    callback(err);
                });
            }
        }, function (err, res) {
            client.close();
            cb(err);
        });
    });
}

function lastClog(client, callback) {
    var data = {
        url: client.url.href
    };
    vasync.pipeline({
        funcs: [
            function (_, cb) {
                cb = once(cb);
                var opts = {scope: 'base'};
                client.search('cn=uuid', opts, function (err, res) {
                    if (err) {
                        return cb(err);
                    }

                    res.once('searchEntry', function (item) {
                        data.uuid = item.object.uuid;
                    });
                    res.once('end', cb.bind(null, null));
                    res.once('error', cb.bind(null));
                });
            },
            function (_, cb) {
                cb = once(cb);
                var controls = [
                    new ldap.ServerSideSortingRequestControl({
                        value: {
                            attributeType: 'changenumber',
                            reverseOrder: true
                        }
                    })
                ];
                var opts = {
                    scope: 'one',
                    sizeLimit: 1,
                    filter: '(changenumber>=0)'
                };
                client.search('cn=changelog', opts,
                                controls, function (err, res) {
                    if (err) {
                        return cb(err);
                    }
                    res.once('searchEntry', function (item) {
                        data.changenumber = parseInt(
                            item.object.changenumber, 10);
                    });
                    res.once('end', cb.bind(null, null));
                    res.once('error', cb.bind(null));
                });
            }
        ]
    }, function (err, res) {
        callback(err, data);
    });
}

function getCheckpoint(client, uuid, cb) {
    cb = once(cb);
    var opts = {
        scope: 'sub',
        filter: new ldap.AndFilter({
            filters: [
                new ldap.EqualityFilter({
                    attribute: 'objectclass',
                    value: 'sdcreplcheckpoint'
                }),
                new ldap.EqualityFilter({
                    attribute: 'uuid',
                    value: uuid
                })
            ]
        })
    };
    client.search('o=smartdc', opts, function (err, res) {
        if (err) {
            return cb(err);
        }
        res.once('searchEntry', function (item) {
            cb(null, {
                dn: item.dn.toString(),
                changenumber: item.object.changenumber
            });
        });
        return null;
    });
}

function setCheckpoint(client, opts, cb) {
    assert.number(opts.changenumber);
    assert.string(opts.uuid);
    assert.string(opts.url);
    var dn = util.format('uuid=%s, o=smartdc', opts.uuid);

    // Create checkpiont if uuid is specified
    if (opts.create) {
        var obj = {
            objectclass: ['sdcreplcheckpoint'],
            uuid: opts.uuid,
            changenumber: opts.changenumber,
            url: opts.url,
            query: []
        };
        client.add(dn, obj, cb.bind(null));
    } else {
        var change = new ldap.Change({
            operation: 'replace',
            modification: {
                type: 'changenumber',
                vals: [opts.changenumber]
            }
        });
        client.modify(dn, change, cb.bind(null));
    }
}

function syncCheckpoint(cb) {
    var clog = {};
    vasync.pipeline({
        funcs: [
            function (_, cb) {
                lastClog(ufdsPrimary.CLIENT, function (err, data) {
                    clog = data;
                    cb(err);
                });
            },
            function (_, cb) {
                clog.create = true;
                setCheckpoint(ufdsReplica.CLIENT, clog, cb);
            }

        ]
    }, function (err, res) {
        cb(err, clog.changenumber);
    });
}

///--- DATA FIXTURING

var FIXTURE = {};
FIXTURE.USER = {
    dn: 'uuid=a820621a-5007-4a2a-9636-edde809106de, ou=users, o=smartdc',
    object: {
        login: 'unpermixed',
        uuid: 'a820621a-5007-4a2a-9636-edde809106de',
        userpassword: 'FL8xhOFL8xhO',
        email: 'postdisseizor@superexist.com',
        cn: 'matching',
        sn: 'popgun',
        company: 'butterflylike',
        address: ['liltingly, Inc.',
        '6165 pyrophyllite Street'],
        city: 'benzoylation concoctive',
        state: 'SP',
        postalCode: '4967',
        country: 'BAT',
        phone: '+1 891 657 5818',
        objectclass: 'sdcperson'
    }
};
/* BEGIN JSSTYLED */
FIXTURE.KEY = {
    dn: 'fingerprint=db:e1:88:bb:a9:ee:ab:be:2f:9c:5b:2f:d9:01:ac:d9, uuid=a820621a-5007-4a2a-9636-edde809106de, ou=users, o=smartdc',
    object: {
        name: 'matching',
        fingerprint: 'db:e1:88:bb:a9:ee:ab:be:2f:9c:5b:2f:d9:01:ac:d9',
        openssh: 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEA1UeAFVU5WaJJwe+rPjN7MbostuTX5P2NOn4c07ymxnFEHSH4LJZkVrMdVQRHf3uHLaTyIpCSZfm5onx0s2DoRpLreH0GYxRNNhmsfGcav0teeC6jSzHjJnn+pLnCDVvyunSFs5/AJGU27KPU4RRF7vNaccPUdB+q4nGJ1H1/+YE= tetartoconid@valvulotomy',
        objectclass: 'sdckey'
    }
};
/* END JSSTYLED */

module.exports = {
    setup: function setup(cb) {
        function recordUUID(instance, callback) {
            lastClog(instance.CLIENT, function (err, res) {
                if (err) {
                    return callback(err);
                }
                instance.UUID = res.uuid;
                callback(null);
            });
        }

        vasync.pipeline({
            funcs: [
                function (_, callback) {
                    // If the buckets exist, blow them away
                    cleanMoray(callback.bind(null, null));
                },
                function createPrimary(_, callback) {
                    var config = baseConfig({
                        host: '127.0.0.1',
                        port: '1389',
                        changelog: {
                            bucket: PRIMARY_CLOG_BUCKET
                        },
                        'o=smartdc': {
                            bucket: PRIMARY_BUCKET
                        }
                    });
                    config.log = LOG.child({ufds: 'primary'});
                    createUFDS(config, function(err, res) {
                        if (err) {
                            return callback(err);
                        }
                        ufdsPrimary = res;
                        return initializeSkeleton(res.CLIENT, callback);
                    });
                },
                function createReplica(_, callback) {
                    var config = baseConfig({
                        host: '127.0.0.1',
                        port: '1390',
                        changelog: {
                            bucket: REPL_CLOG_BUCKET
                        },
                        'o=smartdc': {
                            bucket: REPL_BUCKET
                        }
                    });
                    config.log = LOG.child({ufds: 'replica'});
                    createUFDS(config, function (err, res) {
                        if (err) {
                            return callback(err);
                        }
                        ufdsReplica = res;
                        return initializeSkeleton(res.CLIENT, callback);
                    });
                },
                function primaryUUID(_, callback) {
                    recordUUID(ufdsPrimary, callback);
                },
                function replicaUUID(_, callback) {
                    recordUUID(ufdsReplica, callback);
                }
            ]
        }, function (err, res) {
            if (err) {
                return cb(err);
            }
            return cb(null, ufdsPrimary, ufdsReplica);
        });
    },
    teardown: function teardown(callback) {
        vasync.pipeline({
            funcs: [
                function (_, cb) {
                    destroyUFDS(ufdsPrimary, cb);
                },
                function (_, cb) {
                    destroyUFDS(ufdsReplica, cb);
                }
            ]
        }, function (err, res) {
            cleanMoray(callback);
        });
    },

    // helpers
    createReplicator: function createReplicator(queries, cb) {
        var config = baseConfig();
        var dn = config.rootDN;
        var passwd = config.rootPassword;

        var repl = new replicator.Replicator({
            log: LOG.child({component: 'replicator'}),
            ldapConfig: {
                url: ufdsReplica.server.url,
                bindDN: dn,
                bindCredentials: passwd
            }
        });


        repl.addRemote({
            url: ufdsPrimary.server.url,
            bindDN: dn,
            bindCredentials: passwd,
            queries: queries
        });

        repl.start();
        repl.once('caughtup', cb.bind(null, repl));
    },

    lastClog: lastClog,

    getCheckpoint: getCheckpoint,
    setCheckpoint: setCheckpoint,
    syncCheckpoint: syncCheckpoint,

    uuid: libuuid.create,
    LOG: LOG,
    baseConfig: baseConfig(),
    FIXTURE: FIXTURE
};
