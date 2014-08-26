// Copyright (c) 2014, Joyent, Inc. All rights reserved.

var test = require('tape').test;
var vasync = require('vasync');
var once = require('once');
var helper = require('./helper');
var ldap = require('ldapjs');
var util = require('util');
var replicator;

// Add Operation:
// - simple
// - simple, non-matching
// - missing parent
// - conflict, matching objectclass
// - conflict, non-matching objectclass

///--- GLOBALS
var PRIMARY;
var REPLICA;
var REPL;
var CHANGENUM;


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

test('fixture', function (t) {
    // FIXME: add conflict entries
    helper.syncCheckpoint(function (err, num) {
        t.ifError(err);
        CHANGENUM = num;
        t.end();
    });
});

test('init replicator', function (t) {
    var queries = [
        '/ou=users, o=smartdc??sub?' +
        '(|(&(objectclass=sdcperson)(login=match*))'+
        '(&(objectclass=sdckey)(name=match*)))'
    ];
    helper.createReplicator(queries, function (repl) {
        t.ok(repl, 'replicator online');
        REPL = repl;
        t.end();
    });
});

test('add - simple', function (t) {
    var uuid = helper.uuid();
    var dn = util.format('uuid=%s, ou=users, o=smartdc', uuid);
    var obj = {
        objectclass: 'sdcperson',
        uuid: uuid,
        login: 'matching',
        email: 'user@domain.tld',
        userpassword: 'GreatestPassword!'
    };
    REPL.once('caughtup', function (url, num) {
        t.equal(num, CHANGENUM+1);
        CHANGENUM = num;
        REPL.once('poll', function () {
            REPLICA.CLIENT.search(dn, {scope: 'base'}, function (err, res) {
                t.ifError(err);
                var found = false;
                res.on('error', t.ifError.bind(t));
                res.once('searchEntry', function (entry) {
                    found = true;
                });
                res.once('end', function () {
                    t.ok(found);
                    t.end();
                });
            });
        });
    });
    PRIMARY.CLIENT.add(dn, obj, function (err, res) {
        t.ifError(err);
    });
});

test('add - non-matching', function (t) {
    var uuid = helper.uuid();
    var dn = util.format('uuid=%s, ou=users, o=smartdc', uuid);
    var obj = {
        objectclass: 'sdcperson',
        uuid: uuid,
        login: 'nonmatch',
        email: 'user2@domain.tld',
        userpassword: 'GreatestPassword!'
    };
    REPL.once('caughtup', function (url, num) {
        t.equal(num, CHANGENUM+1);
        CHANGENUM = num;
        REPL.once('poll', function () {
            // The checkpoint should not be modified
            t.end();
        });
    });


    PRIMARY.CLIENT.add(dn, obj, function (err, res) {
        t.ifError(err);
    });
});

test('add - missing parent', function (t) {
    t.fail('FIXME');
    t.end();
});

test('add - conflict, matching objectClass', function (t) {
    t.fail('FIXME');
    t.end();
});

test('add - conflict, non-matching objectClass', function (t) {
    t.fail('FIXME');
    t.end();
});

test('closeReplicator', function (t) {
    REPL.destroy();
    REPL.once('destroy', function () {
        REPL.on('error', function () {});
        t.end();
    });
});

test('teardown', function (t) {
    helper.teardown(function (err) {
        t.ifError(err);
        t.end();
    });
});
