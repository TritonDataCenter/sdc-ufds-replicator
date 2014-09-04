/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

var test = require('tape').test;
var vasync = require('vasync');
var once = require('once');
var helper = require('./helper');
var replicator;


///--- Globals

var LOG = helper.LOG;
var PRIMARY;
var REPLICA;
var REPL;


///--- Fixture data
var fixture = {};
fixture.user = {
    dn: 'uuid=a820621a-5007-4a2a-9636-edde809106de, ou=users, o=smartdc',
    object: {
        login: 'unpermixed',
        uuid: 'a820621a-5007-4a2a-9636-edde809106de',
        userpassword: 'FL8xhOFL8xhO',
        email: 'postdisseizor@superexist.com',
        cn: 'Judophobism',
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
fixture.key = {
    dn: 'fingerprint=db:e1:88:bb:a9:ee:ab:be:2f:9c:5b:2f:d9:01:ac:d9, uuid=a820621a-5007-4a2a-9636-edde809106de, ou=users, o=smartdc',
    object: {
        name: 'flashlight',
        fingerprint: 'db:e1:88:bb:a9:ee:ab:be:2f:9c:5b:2f:d9:01:ac:d9',
        openssh: 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEA1UeAFVU5WaJJwe+rPjN7MbostuTX5P2NOn4c07ymxnFEHSH4LJZkVrMdVQRHf3uHLaTyIpCSZfm5onx0s2DoRpLreH0GYxRNNhmsfGcav0teeC6jSzHjJnn+pLnCDVvyunSFs5/AJGU27KPU4RRF7vNaccPUdB+q4nGJ1H1/+YE= tetartoconid@valvulotomy',
        objectclass: 'sdckey'
    }
};
/* END JSSTYLED */


///--- Helpers

function waitCaughtUp(_, cb) {
    REPL.once('caughtup', cb.bind(null, null));
}


///--- Tests

test('load', function (t) {
    replicator = require('../lib/index');
    t.end();
});

test('setup', function (t) {
    helper.setup(function (err, pri, repl) {
        t.ifError(err);
        t.ok(pri);
        t.ok(repl);
        PRIMARY = pri;
        REPLICA = repl;
        t.end();
    });
});

test('initReplicator', function (t) {
    var dn = helper.baseConfig.rootDN;
    var passwd = helper.baseConfig.rootPassword;
    REPL = new replicator.Replicator({
        log: LOG.child({component: 'replicator'}),
        ldapConfig: {
            url: REPLICA.server.url,
            bindDN: dn,
            bindCredentials: passwd
        }
    });

    REPL.addRemote({
        url: PRIMARY.server.url,
        bindDN: dn,
        bindCredentials: passwd,
        queries: [
            '/ou=users, o=smartdc??sub?' +
                '(|(objectclass=sdcperson)(objectclass=sdckey))'
        ]
    });
    REPL.start();
    REPL.once('caughtup', t.end.bind(null, null));
});


// Initialization:
// - equal versions
// - master is newer
// - create checkpoint
// - query checkpoint
// - upgrade checkpoint (?)


test('add user/key', function (t) {
    var user = fixture.user;
    var key = fixture.key;

    function addEntry(dn, obj) {
        return function (_, cb) {
            PRIMARY.CLIENT.add(dn, obj, function (err) {
                t.ifError(err);
                cb(err);
            });
        };
    }
    function searchEntry(dn) {
        return function (_, cb) {
            cb = once(cb);
            var opts = {scope: 'base'};
            REPLICA.CLIENT.search(dn, opts, function (err, res) {
                if (err) {
                    t.ifError(err);
                    return cb(err);
                }
                var count = 0;
                res.on('searchEntry', function (entry) {
                    t.ok(entry);
                    count++;
                });
                res.on('end', function () {
                    t.equal(count, 1);
                    cb();
                });
                res.on('err', cb.bind(null));
                return null;
            });
        };
    }

    vasync.pipeline({
        funcs: [
            addEntry(user.dn, user.object),
            addEntry(key.dn, key.object),
            waitCaughtUp,
            searchEntry(user.dn),
            searchEntry(key.dn)
        ]
    }, function (err, res) {
        t.end();
    });
});

test('mod user/key', function (t) {
    // Change value of 'cn' field to 'changed'
    function modEntry(dn, key, value) {
        return function (_, cb) {
            var mod = {
                operation: 'replace',
                modification: {
                    type: key,
                    vals: [value]
                }
            };
            PRIMARY.CLIENT.modify(dn, mod, function (err) {
                t.ifError(err);
                cb(err);
            });
        };
    }

    function checkEntry(dn, key, value) {
        return function (_, cb) {
            cb = once(cb);
            var opts = {scope: 'base'};
            REPLICA.CLIENT.search(dn, opts, function (err, res) {
                t.ifError(err);
                res.once('error', cb.bind(null));
                res.once('searchEntry', function (item) {
                    t.equal(item.object[key], value);
                    cb();
                });
            });
        };
    }
    vasync.pipeline({
        funcs: [
            modEntry(fixture.user.dn, 'cn', 'changed'),
            waitCaughtUp,
            checkEntry(fixture.user.dn, 'cn', 'changed')
        ]
    }, function (err, res) {
        t.ifError(err);
        t.end();
    });
});

test('del user/key', function (t) {
    var user = fixture.user.dn;
    var key = fixture.key.dn;

    function delEntry(dn, obj) {
        return function (_, cb) {
            PRIMARY.CLIENT.del(dn, function (err) {
                t.ifError(err);
                cb(err);
            });
        };
    }
    function missingEntry(dn) {
        return function (_, cb) {
            cb = once(cb);
            var opts = {scope: 'base'};
            REPLICA.CLIENT.search(dn, opts, function (err, res) {
                t.ifError(err);
                res.once('error', function (sErr) {
                    t.equal(sErr.name, 'NoSuchObjectError');
                    cb();
                });
                res.once('end', function () {
                    t.fail('entry not deleted');
                    cb();
                });
            });
        };
    }

    vasync.pipeline({
        funcs: [
            delEntry(key),
            delEntry(user),
            waitCaughtUp,
            missingEntry(key),
            missingEntry(user)
        ]
    }, function (err, res) {
        t.ifError(err);
        t.end();
    });
});

test('closeReplicator', function (t) {
    REPL.destroy();
    t.end();
});

test('teardown', function (t) {
    helper.teardown(function (err) {
        t.ifError(err);
        t.end();
    });
});
