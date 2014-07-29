var test = require('tape').test;
var helper = require('./helper');
var replicator;


var LOG = helper.LOG;
var PRIMARY;
var REPLICA;
var REPL;


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
        console.log('done');
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
            "/ou=users, o=smartdc??sub?" +
                "(&(!(objectclass=amonprobe)(!(objectclass=amonprobegroup))))"
        ]
    });
    t.end();
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
