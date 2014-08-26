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
var ldap = require('ldapjs');


var client;


test('start', function (t) {
    client = ldap.createClient({
        url: 'ldaps://10.99.99.18',
        tlsOptions: {rejectUnauthorized: false},
        bindDN: 'cn=root',
        bindCredentials: 'secret'
    });
    client.on('connect', function () {
        t.end();
    });
});

function asdf(cb) {
    var opts = {
        scope: 'one',
        sizeLimit: 1,
        filter: '(changenumber>0)'
    };
    var control = new ldap.ServerSideSortingRequestControl({
        value: {
            attributeType: 'changenumber',
            reverseOrder: true
        }
    });
    client.search('cn=changelog', opts, function (err, res) {
        return cb(err);
    });
}

test('fixture', function (t) {
    var clog;

    //lastClog(PRIMARY.CLIENT, function (err, data) {
    //    console.log(err, data);
    //    t.ifError(err);
    //    clog = data;
    //    t.end();
    //});
    vasync.pipeline({
        funcs: [
            function one(_, cb) {
                console.log('one');
                cb(null, null);
            },
            function two(_, cb) {
                console.log('two');
                asdf(cb);
            }
        ]
    }, function (err, res) {
        console.log(err);
        t.end();
    });
});
