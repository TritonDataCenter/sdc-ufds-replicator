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

// Modify Operation:
// - new/old match query (mod)
// - neither match query (noop)
// - new doesn't match, old does (del)
// - new matches, old doesn't (mod)
// - local missing, new matches (add)
