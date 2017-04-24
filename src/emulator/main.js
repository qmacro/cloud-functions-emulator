/**
 * Copyright 2017, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License")
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

require('colors');

const _ = require('lodash');
const cli = require('yargs');
const Configstore = require('configstore');
const path = require('path');
const winston = require('winston');

const defaults = require('../defaults.json');
const Emulator = require('./emulator');
const logs = require('./logs');
const OPTIONS = require('../options');
const pkg = require('../../package.json');
const server = new Configstore(path.join(pkg.name, '/.active-server'));

const COMMAND = `./bin/emulator ${'[options]'.yellow}`;
const DESCRIPTION = `The Google Cloud Functions Emulator service. The service implements both the REST and gRPC versions of the Google
  Cloud Functions API.

  You can use the CLI to manage the service, or deploy the service manually.`;
const USAGE = `Usage:
  In the cloud-functions-emulator directory:

    ${('npm start -- ' + '[options]'.yellow).bold}

  or

    ${COMMAND.bold}

  From anywhere:

    ${('/path/to/cloud-functions-emulator/bin/emulator ' + '[options]'.yellow).bold}

  If you're using the CLI (npm install -g @google-cloud/functions-emulator):

    ${('functions start ' + '[options]'.yellow).bold}

Description:
  ${DESCRIPTION}`;

function main (args) {
  let opts = cli
    .usage(USAGE)
    .options(_.merge(_.pick(OPTIONS, require('../cli/commands/start').options), {
      config: {
        alias: 'c',
        description: 'Path to a config .json file.',
        type: 'string'
      }
    }))
    .example('bin/emulator --verbose', 'Start the Emulator in verbose mode.')
    .wrap(120)
    .help()
    .version()
    .strict()
    .argv;

  if (opts.config) {
    _.merge(opts, require(path.resolve(opts.config)));
  }
  opts = _.merge(defaults, opts);

  opts.logFile = opts.logFile ? logs.assertLogsPath(opts.logFile) : opts.logFile;

  // Add a global error handler to catch all unexpected exceptions in the process
  // Note that this will not include any unexpected system errors (syscall failures)
  process.on('uncaughtException', function (err) {
    console.error(err.stack);

    // HACK: An uncaught exception may leave the process in an incomplete state
    // however exiting the process prematurely may result in the above log call
    // to not complete. Thus we're just going to wait for an arbitrary amount
    // of time for the log entry to complete.
    // Possible future solution here: https://github.com/winstonjs/winston/issues/228
    setTimeout(function () {
      process.exit(1);
    }, 2000);
  });

  // Setup the winston logger.  We're going to write to a file which will
  // automatically roll when it exceeds ~1MB.
  let logLevel = 'info';

  if (opts.verbose === true) {
    logLevel = 'debug';
  }

  const logger = new winston.Logger({
    transports: [
      new winston.transports.Console({
        json: false,
        level: 'error'
      }),
      new winston.transports.File({
        json: false,
        filename: opts.logFile,
        level: logLevel
      })
    ],
    exitOnError: false
  });

  // Override default console log calls to redirect them to winston.
  // This is required because when the server is run as a spawned process
  // from the CLI, stdout and stderr will be written to /dev/null.  In order
  // to capture logs emitted from user functions we need to globally redirect
  // console logs for this process.  Note that this will also redirect logs
  // from the emulator itself, so all emulator logs should be written at the
  // DEBUG level.  We've made an exception for error logs in the emulator, just
  // to make it easier for developers to recognize failures in the emulator.

  console.log = (...args) => logger.info(...args);
  console.info = console.log;
  console.error = (...args) => logger.error(...args);
  console.debug = (...args) => logger.debug(...args);

  console.debug('main', opts);

  const emulator = new Emulator(opts);

  emulator.start();

  // The CLI uses SIGTERM to tell the Emulator that it needs to shut down.
  process.on('SIGTERM', () => emulator.stop());

  process.on('exit', () => {
    const pid = server.get('pid');
    try {
      server.delete('pid');
      server.set('stopped', Date.now());
      if (pid) {
        server.set('lastKnownPid', pid);
      }
    } catch (err) {

    }
  });
}

module.exports = main;
