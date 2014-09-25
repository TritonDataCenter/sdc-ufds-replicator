<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# SDC-UFDS-Replicator

This repository is part of the Joyent SmartDataCenter project (SDC).  For
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.


# Overview

UFDS Replicator is the service used for selectively replicating collections of
objects from one or more master UFDS instances to a local replica instance.


# Development

To run the boilerplate API server:

    git submodule update --init
    make all
    node replicator.js

Before commiting/pushing run `make prepush` and, if possible, get a code
review.

# Testing

    make test

If you project has setup steps necessary for testing, then describe those
here.
