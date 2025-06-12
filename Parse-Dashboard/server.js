/*
 * Copyright (c) 2016-present, Parse, LLC
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const parseDashboard = require('./app');

module.exports = (options) => {
  const host = options.host || process.env.HOST || '0.0.0.0';
  const port = options.port || process.env.PORT || 4040;
  const mountPath = options.mountPath || process.env.MOUNT_PATH || '/';
  const allowInsecureHTTP = options.allowInsecureHTTP || process.env.PARSE_DASHBOARD_ALLOW_INSECURE_HTTP;
  const cookieSessionSecret = options.cookieSessionSecret || process.env.PARSE_DASHBOARD_COOKIE_SESSION_SECRET;
  const trustProxy = options.trustProxy || process.env.PARSE_DASHBOARD_TRUST_PROXY;
  const cookieSessionMaxAge = options.cookieSessionMaxAge || process.env.PARSE_DASHBOARD_COOKIE_SESSION_MAX_AGE;
  const dev = options.dev;

  if (trustProxy && allowInsecureHTTP) {
    console.log('Set only trustProxy *or* allowInsecureHTTP, not both. Only one is needed to handle being behind a proxy.');
    process.exit(-1);
  }

  const explicitConfigFileProvided = !!options.config;
  let configFile = null;
  let configFromCLI = null;
  const configServerURL = options.serverURL || process.env.PARSE_DASHBOARD_SERVER_URL;
  const configGraphQLServerURL = options.graphQLServerURL || process.env.PARSE_DASHBOARD_GRAPHQL_SERVER_URL;
  const configMasterKey = options.masterKey || process.env.PARSE_DASHBOARD_MASTER_KEY;
  const configAppId = options.appId || process.env.PARSE_DASHBOARD_APP_ID;
  const configAppName = options.appName || process.env.PARSE_DASHBOARD_APP_NAME;
  const configUserId = options.userId || process.env.PARSE_DASHBOARD_USER_ID;
  const configUserPassword = options.userPassword || process.env.PARSE_DASHBOARD_USER_PASSWORD;
  const configSSLKey = options.sslKey || process.env.PARSE_DASHBOARD_SSL_KEY;
  const configSSLCert = options.sslCert || process.env.PARSE_DASHBOARD_SSL_CERT;

  function handleSIGs(server) {
    const signals = { 'SIGINT': 2, 'SIGTERM': 15 };
    function shutdown(signal, value) {
      server.close(() => {
        console.log('server stopped by ' + signal);
        process.exit(128 + value);
      });
    }
    Object.keys(signals).forEach(signal => {
      process.on(signal, () => shutdown(signal, signals[signal]));
    });
  }

  if (!options.config && !process.env.PARSE_DASHBOARD_CONFIG) {
    if (configServerURL && configMasterKey && configAppId) {
      configFromCLI = {
        data: {
          apps: [{
            appId: configAppId,
            serverURL: configServerURL,
            masterKey: configMasterKey,
            appName: configAppName,
          }]
        }
      };
      if (configGraphQLServerURL) {
        configFromCLI.data.apps[0].graphQLServerURL = configGraphQLServerURL;
      }
      if (configUserId && configUserPassword) {
        configFromCLI.data.users = [{
          user: configUserId,
          pass: configUserPassword,
        }];
      }
    } else if (!configServerURL && !configMasterKey && !configAppName) {
      configFile = path.join(__dirname, 'parse-dashboard-config.json');
    }
  } else if (!options.config && process.env.PARSE_DASHBOARD_CONFIG) {
    configFromCLI = {
      data: JSON.parse(process.env.PARSE_DASHBOARD_CONFIG)
    };
  } else {
    configFile = options.config;
    if (options.appId || options.serverURL || options.masterKey || options.appName || options.graphQLServerURL) {
      console.log('You must provide either a config file or other CLI options; not both.');
      process.exit(3);
    }
  }

  let config = null;
  let configFilePath = null;
  if (configFile) {
    try {
      config = {
        data: JSON.parse(fs.readFileSync(configFile, 'utf8'))
      };
      configFilePath = path.dirname(configFile);
    } catch (error) {
      console.error('Config load error:', error.message);
      process.exit(error.code === 'ENOENT' ? 2 : 1);
    }
  } else if (configFromCLI) {
    config = configFromCLI;
  } else {
    console.log('You must provide either a config file or CLI options. See parse-dashboard --help for details.');
    process.exit(4);
  }

  config.data.apps.forEach(app => {
    if (!app.appName) app.appName = app.appId;
  });

  const app = express();

  // Serve static icons if defined
  if (config.data.iconsFolder) {
    const resolvedIconsPath = path.resolve(__dirname, '../', config.data.iconsFolder);
    if (fs.existsSync(resolvedIconsPath)) {
      app.use('/appicons', express.static(resolvedIconsPath));
    } else {
      console.warn(`Iconsfolder at path: ${resolvedIconsPath} not found!`);
    }
  }

  if (allowInsecureHTTP || trustProxy || dev) {
    app.enable('trust proxy');
  }

  config.data.trustProxy = trustProxy;
  const dashboardOptions = { allowInsecureHTTP, cookieSessionSecret, dev, cookieSessionMaxAge };
  app.use(mountPath, parseDashboard(config.data, dashboardOptions));

  let server;
  if (!configSSLKey || !configSSLCert) {
    server = app.listen(port, host, () => {
      console.log(`The dashboard is now available at http://${server.address().address}:${server.address().port}${mountPath}`);
    });
  } else {
    const privateKey = fs.readFileSync(configSSLKey);
    const certificate = fs.readFileSync(configSSLCert);
    server = require('https').createServer({ key: privateKey, cert: certificate }, app).listen(port, host, () => {
      console.log(`The dashboard is now available at https://${server.address().address}:${server.address().port}${mountPath}`);
    });
  }

  handleSIGs(server);
};