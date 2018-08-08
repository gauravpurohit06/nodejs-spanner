/*!
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const arrify = require('arrify');
const {promisifyAll} = require('@google-cloud/promisify');
const {ServiceObject} = require('@google-cloud/common-grpc');
const events = require('events');
const extend = require('extend');
const is = require('is');
const modelo = require('modelo');

const BatchTransaction = require('./batch-transaction');
const codec = require('./codec');
const PartialResultStream = require('./partial-result-stream');
const Session = require('./session');
const SessionPool = require('./session-pool');
const Table = require('./table');
const TransactionRequest = require('./transaction-request');

/**
 * Create a Database object to interact with a Cloud Spanner database.
 *
 * @class
 *
 * @param {string} name Name of the database.
 * @param {SessionPoolOptions} options Session pool configuration options.
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 */
function Database(instance, name, poolOptions) {
  const self = this;

  this.request = instance.request;
  this.requestStream = instance.requestStream;

  this.formattedName_ = Database.formatName_(instance.formattedName_, name);

  this.pool_ = new SessionPool(this, poolOptions);
  this.pool_.on('error', this.emit.bind(this, 'error'));
  this.pool_.open();

  const methods = {
    /**
     * Create a database.
     *
     * @method Database#create
     * @param {CreateDatabaseRequest} [options] Configuration object.
     * @param {CreateDatabaseCallback} [callback] Callback function.
     * @returns {Promise<CreateDatabaseResponse>}
     *
     * @example
     * const Spanner = require('@google-cloud/spanner');
     * const spanner = new Spanner();
     * const instance = spanner.instance('my-instance');
     * const database = instance.database('my-database');
     *
     * database.create(function(err, database, operation, apiResponse) {
     *   if (err) {
     *     // Error handling omitted.
     *   }
     *
     *   operation
     *     .on('error', function(err) {})
     *     .on('complete', function() {
     *       // Database created successfully.
     *     });
     * });
     *
     * //-
     * // If the callback is omitted, we'll return a Promise.
     * //-
     * database.create()
     *   .then(function(data) {
     *     const operation = data[0];
     *     const apiResponse = data[1];
     *
     *     return operation.promise();
     *   })
     *   .then(function() {
     *     // Database created successfully.
     *   });
     */
    create: true,

    /**
     * @typedef {array} DatabaseExistsResponse
     * @property {boolean} 0 Whether the {@link Database} exists.
     */
    /**
     * @callback DatabaseExistsCallback
     * @param {?Error} err Request error, if any.
     * @param {boolean} exists Whether the {@link Database} exists.
     */
    /**
     * Check if a database exists.
     *
     * @method Database#exists
     * @param {DatabaseExistsCallback} [callback] Callback function.
     * @returns {Promise<DatabaseExistsResponse>}
     *
     * @example
     * const Spanner = require('@google-cloud/spanner');
     * const spanner = new Spanner();
     *
     * const instance = spanner.instance('my-instance');
     * const database = instance.database('my-database');
     *
     * database.exists(function(err, exists) {});
     *
     * //-
     * // If the callback is omitted, we'll return a Promise.
     * //-
     * database.exists().then(function(data) {
     *   const exists = data[0];
     * });
     */
    exists: true,
  };

  ServiceObject.call(this, {
    parent: instance,
    id: name,
    methods: methods,
    createMethod: function(_, options, callback) {
      return instance.createDatabase(self.formattedName_, options, callback);
    },
  });

  events.EventEmitter.call(this);
}

modelo.inherits(Database, ServiceObject, events.EventEmitter);

/**
 * Format the database name to include the instance name.
 *
 * @private
 *
 * @param {string} instanceName The formatted instance name.
 * @param {string} name The table name.
 *
 * @example
 * Database.formatName_(
 *   'projects/grape-spaceship-123/instances/my-instance',
 *   'my-database'
 * );
 * // 'projects/grape-spaceship-123/instances/my-instance/tables/my-database'
 */
Database.formatName_ = function(instanceName, name) {
  if (name.indexOf('/') > -1) {
    return name;
  }

  const databaseName = name.split('/').pop();

  return instanceName + '/databases/' + databaseName;
};

/**
 * Get a reference to a {@link BatchTransaction} object.
 *
 * @see {@link BatchTransaction#identifier} to generate an identifier.
 *
 * @param {TransactionIdentifier} identifier The transaction identifier.
 * @param {TransactionOptions} [options] [Transaction options](https://cloud.google.com/spanner/docs/timestamp-bounds).
 * @returns {BatchTransaction} A batch transaction object.
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * const transaction = database.batchTransaction({
 *   session: 'my-session',
 *   transaction: 'my-transaction',
 *   readTimestamp: 1518464696657
 * });
 */
Database.prototype.batchTransaction = function(identifier) {
  let session = identifier.session;
  const id = identifier.transaction;

  if (is.string(session)) {
    session = this.session_(session);
  }

  const transaction = new BatchTransaction(session);

  transaction.id = id;
  transaction.readTimestamp = identifier.readTimestamp;

  return transaction;
};

/**
 * @callback CloseDatabaseCallback
 * @param {?Error} err Request error, if any.
 */
/**
 * Close the database connection and destroy all sessions associated with it.
 *
 * @param {CloseDatabaseCallback} [callback] Callback function.
 * @returns {Promise}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.close(function(err) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 * });
 *
 * //-
 * // In the event of a session leak, the error object will contain a
 * // `messages` field.
 * //-
 * database.close(function(err) {
 *   if (err && err.messages) {
 *     err.messages.forEach(function(message) {
 *       console.error(message);
 *     });
 *   }
 * });
 */
Database.prototype.close = function(callback) {
  const key = this.id.split('/').pop();
  let leakError = null;
  const leaks = this.pool_.getLeaks();

  if (leaks.length) {
    leakError = new Error(`${leaks.length} session leak(s) found.`);
    leakError.messages = leaks;
  }

  this.parent.databases_.delete(key);
  this.pool_.close().then(() => callback(leakError), callback);
};

/**
 * @typedef {array} CreateTransactionResponse
 * @property {BatchTransaction} 0 The {@link BatchTransaction}.
 * @property {object} 1 The full API response.
 */
/**
 * @callback CreateTransactionCallback
 * @param {?Error} err Request error, if any.
 * @param {BatchTransaction} transaction The {@link BatchTransaction}.
 * @param {object} apiResponse The full API response.
 */
/**
 * Create a transaction that can be used for batch querying.
 *
 * @param {TransactionOptions} [options] [Transaction options](https://cloud.google.com/spanner/docs/timestamp-bounds).
 * @param {CreateTransactionCallback} [callback] Callback function.
 * @returns {Promise<CreateTransactionResponse>}
 */
Database.prototype.createBatchTransaction = function(options, callback) {
  const self = this;

  if (is.fn(options)) {
    callback = options;
    options = null;
  }

  this.createSession(function(err, session, resp) {
    if (err) {
      callback(err, null, resp);
      return;
    }

    const transaction = self.batchTransaction({session});

    transaction.options = extend({}, options);

    transaction.begin(function(err, resp) {
      if (err) {
        callback(err, null, resp);
        return;
      }

      callback(null, transaction, resp);
    });
  });
};

/**
 * @typedef {array} CreateTableResponse
 * @property {Table} 0 The new {@link Table}.
 * @property {Operation} 1 An {@link Operation} object that can be used to check
 *     the status of the request.
 * @property {object} 2 The full API response.
 */
/**
 * @callback CreateTableCallback
 * @param {?Error} err Request error, if any.
 * @param {Table} table The new {@link Table}.
 * @param {Operation} operation An {@link Operation} object that can be used to
 *     check the status of the request.
 * @param {object} apiResponse The full API response.
 */
/**
 * Create a table.
 *
 * Wrapper around {@link Database#updateSchema}.
 *
 * @see {@link Database#updateSchema}
 *
 * @param {string} schema A DDL CREATE statement describing the table.
 * @param {CreateTableCallback} [callback] Callback function.
 * @returns {Promise<CreateTableResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * const schema =
 *   'CREATE TABLE Singers (' +
 *   '  SingerId INT64 NOT NULL,' +
 *   '  FirstName STRING(1024),' +
 *   '  LastName STRING(1024),' +
 *   '  SingerInfo BYTES(MAX),' +
 *   ') PRIMARY KEY(SingerId)';
 *
 * database.createTable(schema, function(err, table, operation, apiResponse) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   operation
 *     .on('error', function(err) {})
 *     .on('complete', function() {
 *       // Table created successfully.
 *     });
 * });
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.createTable(schema)
 *   .then(function(data) {
 *     const table = data[0];
 *     const operation = data[1];
 *
 *     return operation.promise();
 *   })
 *   .then(function() {
 *     // Table created successfully.
 *   });
 */
Database.prototype.createTable = function(schema, callback) {
  const self = this;

  this.updateSchema(schema, function(err, operation, resp) {
    if (err) {
      callback(err, null, null, resp);
      return;
    }

    const tableName = schema.match(/CREATE TABLE `*([^\s`(]+)/)[1];
    const table = self.table(tableName);

    callback(null, table, operation, resp);
  });
};

/**
 * Delete the database.
 *
 * Wrapper around {@link v1.DatabaseAdminClient#dropDatabase}.
 *
 * @see {@link v1.DatabaseAdminClient#dropDatabase}
 * @see [DropDatabase API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.admin.database.v1#google.spanner.admin.database.v1.DatabaseAdmin.DropDatabase)
 * @param {BasicCallback} [callback] Callback function.
 * @returns {Promise<BasicResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.delete(function(err, apiResponse) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   // Database was deleted successfully.
 * });
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.delete().then(function(data) {
 *   const apiResponse = data[0];
 * });
 */
Database.prototype.delete = function(callback) {
  const self = this;
  const reqOpts = {
    database: this.formattedName_,
  };

  this.close(function() {
    self.request(
      {
        client: 'DatabaseAdminClient',
        method: 'dropDatabase',
        reqOpts: reqOpts,
      },
      callback
    );
  });
};

/**
 * @typedef {array} GetDatabaseResponse
 * @property {Database} 0 The {@link Database}.
 * @property {object} 1 The full API response.
 */
/**
 * @callback GetDatabaseCallback
 * @param {?Error} err Request error, if any.
 * @param {Database} database The {@link Database}.
 * @param {object} apiResponse The full API response.
 */
/**
 * Get a database if it exists.
 *
 * You may optionally use this to "get or create" an object by providing an
 * object with `autoCreate` set to `true`. Any extra configuration that is
 * normally required for the `create` method must be contained within this
 * object as well.
 *
 * @param {options} [options] Configuration object.
 * @param {boolean} [options.autoCreate=false] Automatically create the
 *     object if it does not exist.
 * @param {GetDatabaseCallback} [callback] Callback function.
 * @returns {Promise<GetDatabaseResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.get(function(err, database, apiResponse) {
 *   // `database.metadata` has been populated.
 * });
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.get().then(function(data) {
 *   const database = data[0];
 *   const apiResponse = data[0];
 * });
 */
Database.prototype.get = function(options, callback) {
  const self = this;

  if (is.fn(options)) {
    callback = options;
    options = {};
  }

  this.getMetadata(function(err, metadata) {
    if (err) {
      if (options.autoCreate && err.code === 5) {
        self.create(options, function(err, database, operation) {
          if (err) {
            callback(err);
            return;
          }

          operation.on('error', callback).on('complete', function(metadata) {
            self.metadata = metadata;
            callback(null, self, metadata);
          });
        });
        return;
      }

      callback(err);
      return;
    }

    callback(null, self, metadata);
  });
};

/**
 * @typedef {array} GetDatabaseMetadataResponse
 * @property {object} 0 The {@link Database} metadata.
 * @property {object} 1 The full API response.
 */
/**
 * @callback GetDatabaseMetadataCallback
 * @param {?Error} err Request error, if any.
 * @param {object} metadata The {@link Database} metadata.
 * @param {object} apiResponse The full API response.
 */
/**
 * Get the database's metadata.
 *
 * Wrapper around {@link v1.DatabaseAdminClient#getDatabase}.
 *
 * @see {@link v1.DatabaseAdminClient#getDatabase}
 * @see [GetDatabase API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.admin.database.v1#google.spanner.admin.database.v1.DatabaseAdmin.GetDatabase)
 *
 * @param {GetDatabaseMetadataCallback} [callback] Callback function.
 * @returns {Promise<GetDatabaseMetadataResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.getMetadata(function(err, metadata, apiResponse) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   // Database was deleted successfully.
 * });
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.getMetadata().then(function(data) {
 *   const metadata = data[0];
 *   const apiResponse = data[1];
 * });
 */
Database.prototype.getMetadata = function(callback) {
  const reqOpts = {
    name: this.formattedName_,
  };

  return this.request(
    {
      client: 'DatabaseAdminClient',
      method: 'getDatabase',
      reqOpts: reqOpts,
    },
    callback
  );
};

/**
 * @typedef {array} GetSchemaResponse
 * @property {string[]} 0 An array of database DDL statements.
 * @property {object} 1 The full API response.
 */
/**
 * @callback GetSchemaCallback
 * @param {?Error} err Request error, if any.
 * @param {string[]} statements An array of database DDL statements.
 * @param {object} apiResponse The full API response.
 */
/**
 * Get this database's schema as a list of formatted DDL statements.
 *
 * Wrapper around {@link v1.DatabaseAdminClient#getDatabaseDdl}.
 *
 * @see {@link v1.DatabaseAdminClient#getDatabaseDdl}
 * @see [Data Definition Language (DDL)](https://cloud.google.com/spanner/docs/data-definition-language)
 * @see [GetDatabaseDdl API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.admin.database.v1#google.spanner.admin.database.v1.DatabaseAdmin.GetDatabaseDdl)
 *
 * @param {GetSchemaCallback} [callback] Callback function.
 * @returns {Promise<GetSchemaResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.getSchema(function(err, statements, apiResponse) {});
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.getSchema().then(function(data) {
 *   const statements = data[0];
 *   const apiResponse = data[1];
 * });
 */
Database.prototype.getSchema = function(callback) {
  const reqOpts = {
    database: this.formattedName_,
  };

  this.request(
    {
      client: 'DatabaseAdminClient',
      method: 'getDatabaseDdl',
      reqOpts: reqOpts,
    },
    function(err, statements) {
      if (statements) {
        arguments[1] = statements.statements;
      }

      callback.apply(null, arguments);
    }
  );
};

/**
 * Options object for listing sessions.
 *
 * @typedef {object} GetSessionsRequest
 * @property {boolean} [autoPaginate=true] Have pagination handled
 *     automatically.
 * @property {string} [filter] An expression for filtering the results of the
 *     request. Filter rules are case insensitive. The fields eligible for
 *     filtering are:
 *     - **`name`**
 *     - **`display_name`**
 *     - **`labels.key`** where key is the name of a label
 *
 *     Some examples of using filters are:
 *     - **`name:*`** The instance has a name.
 *     - **`name:Howl`** The instance's name is howl.
 *     - **`labels.env:*`** The instance has the label env.
 *     - **`labels.env:dev`** The instance's label env has the value dev.
 *     - **`name:howl labels.env:dev`** The instance's name is howl and it has
 *       the label env with value dev.
 * @property {number} [maxApiCalls] Maximum number of API calls to make.
 * @property {number} [maxResults] Maximum number of items to return.
 * @property {number} [pageSize] Maximum number of results per page.
 * @property {string} [pageToken] A previously-returned page token
 *     representing part of the larger set of results to view.
 */
/**
 * @typedef {array} GetSessionsResponse
 * @property {Session[]} 0 Array of {@link Session} instances.
 * @property {object} 1 The full API response.
 */
/**
 * @callback GetSessionsCallback
 * @param {?Error} err Request error, if any.
 * @param {Session[]} instances Array of {@link Session} instances.
 * @param {object} apiResponse The full API response.
 */
/**
 * Geta a list of sessions.
 *
 * Wrapper around {@link v1.SpannerClient#listSessions}
 *
 * @see {@link v1.SpannerClient#listSessions}
 * @see [ListSessions API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.v1#google.spanner.v1.Spanner.ListSessions)
 *
 * @param {GetSessionsRequest} [options] Options object for listing sessions.
 * @param {GetSessionsCallback} [callback] Callback function.
 * @returns {Promise<GetSessionsResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.getSessions(function(err, sessions) {
 *   // `sessions` is an array of `Session` objects.
 * });
 *
 * //-
 * // To control how many API requests are made and page through the results
 * // manually, set `autoPaginate` to `false`.
 * //-
 * function callback(err, sessions, nextQuery, apiResponse) {
 *   if (nextQuery) {
 *     // More results exist.
 *     database.getSessions(nextQuery, callback);
 *   }
 * }
 *
 * database.getInstances({
 *   autoPaginate: false
 * }, callback);
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.getInstances().then(function(data) {
 *   const sessions = data[0];
 * });
 */
Database.prototype.getSessions = function(options, callback) {
  const self = this;

  if (is.fn(options)) {
    callback = options;
    options = {};
  }

  const gaxOpts = options.gaxOptions;
  const reqOpts = extend({}, options, {database: this.formattedName_});
  delete reqOpts.gaxOptions;

  this.request(
    {
      client: 'SpannerClient',
      method: 'listSessions',
      reqOpts,
      gaxOpts,
    },
    function(err, sessions) {
      if (sessions) {
        arguments[1] = sessions.map(function(metadata) {
          const session = self.session_(metadata.name);
          session.metadata = metadata;
          return session;
        });
      }

      callback.apply(null, arguments);
    }
  );
};

/**
 * @typedef {array} GetTransactionResponse
 * @property {Transaction} 0 The transaction object.
 */
/**
 * @callback GetTransactionCallback
 * @param {?Error} err Request error, if any.
 * @param {Transaction} transaction The transaction object.
 */
/**
 * Get a read/write ready Transaction object.
 *
 * Wrapper around {@link v1.SpannerClient#beginTransaction}.
 *
 * @see {@link v1.SpannerClient#beginTransaction}
 *
 * @param {TransactionOptions} [options] [Transaction options](https://cloud.google.com/spanner/docs/timestamp-bounds).
 * @param {GetTransactionCallback} [callback] Callback function.
 * @returns {Promise<GetTransactionResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.getTransaction(function(err, transaction) {});
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.getTransaction().then(function(data) {
 *   const transaction = data[0];
 * });
 */
Database.prototype.getTransaction = function(options, callback) {
  const pool = this.pool_;

  if (is.fn(options)) {
    callback = options;
    options = null;
  }

  if (!options || !options.readOnly) {
    pool.getWriteSession().then(function(session) {
      callback(null, session.txn);
    }, callback);
    return;
  }

  pool
    .getSession()
    .then(function(session) {
      return pool.createTransaction_(session, options);
    })
    .then(function(transaction) {
      callback(null, transaction);
    })
    .catch(callback);
};

/**
 * Transaction options.
 *
 * @typedef {object} DatabaseRunRequest
 * @property {number} [exactStaleness] Executes all reads at the timestamp
 *     that is `exactStaleness` old.
 * @property {date} [readTimestamp] Execute all reads at the given
 *     timestamp.
 * @property {boolean} [strong] Read at the timestamp where all previously
 *     committed transactions are visible.
 */
/**
 * @typedef {array} RunResponse
 * @property {array[]} 0 Rows are returned as an array of objects. Each object
 *     has a `name` and `value` property. To get a serialized object, call
 *     `toJSON()`.
 */
/**
 * @callback RunCallback
 * @param {?Error} err Request error, if any.
 * @param {array[]} rows Rows are returned as an array of objects. Each object
 *     has a `name` and `value` property. To get a serialized object, call
 *     `toJSON()`.
 */
/**
 * Execute a SQL statement on this database.
 *
 * Wrapper around {@link v1.SpannerClient#executeStreamingSql}.
 *
 * @see {@link v1.SpannerClient#executeStreamingSql}
 * @see [Query Syntax](https://cloud.google.com/spanner/docs/query-syntax)
 * @see [ExecuteSql API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.v1#google.spanner.v1.Spanner.ExecuteSql)
 *
 * @param {string|object} query A SQL query or query object. See an
 *     [ExecuteSqlRequest](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.v1#google.spanner.v1.ExecuteSqlRequest)
 *     object.
 * @param {boolean} [query.json=false] Receive the rows as serialized objects.
 *     This is the equivalent of calling `toJSON()` on each row.
 * @param {object} [query.jsonOptions] Configuration options for the serialized
 *     objects.
 * @param {boolean} [query.jsonOptions.wrapNumbers=false] Protect large integer
 *     values outside of the range of JavaScript Number.
 * @param {object} [query.params] A map of parameter name to values.
 * @param {object} [query.types] A map of parameter types.
 * @param {DatabaseRunRequest} [options] [Transaction options](https://cloud.google.com/spanner/docs/timestamp-bounds).
 * @param {RunCallback} [callback] Callback function.
 * @returns {Promise<RunResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * const query = 'SELECT * FROM Singers';
 *
 * database.run(query, function(err, rows) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   const firstRow = rows[0];
 *
 *   // firstRow = [
 *   //   {
 *   //     name: 'SingerId',
 *   //     value: '1'
 *   //   },
 *   //   {
 *   //     name: 'Name',
 *   //     value: 'Eddie Wilson'
 *   //   }
 *   // ]
 * });
 *
 * //-
 * // Rows are returned as an array of object arrays. Each object has a `name`
 * // and `value` property. To get a serialized object, call `toJSON()`.
 * //-
 * database.run(query, function(err, rows) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   const firstRow = rows[0];
 *
 *   // firstRow.toJSON() = {
 *   //   SingerId: '1',
 *   //   Name: 'Eddie Wilson'
 *   // }
 * });
 *
 * //-
 * // Alternatively, set `query.json` to `true`, and this step will be performed
 * // automaticaly.
 * //-
 * database.run(query, function(err, rows) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   const firstRow = rows[0];
 *
 *   // firstRow = {
 *   //   SingerId: '1',
 *   //   Name: 'Eddie Wilson'
 *   // }
 * });
 *
 * //-
 * // The SQL query string can contain parameter placeholders. A parameter
 * // placeholder consists of '@' followed by the parameter name.
 * //-
 * const query = {
 *   sql: 'SELECT * FROM Singers WHERE name = @name',
 *   params: {
 *     name: 'Eddie Wilson'
 *   }
 * };
 *
 * database.run(query, function(err, rows) {});
 *
 * //-
 * // If you need to enforce a specific param type, a types map can be provided.
 * // This is typically useful if your param value can be null.
 * //-
 * const query = {
 *   sql: 'SELECT * FROM Singers WHERE name = @name AND id = @id',
 *   params: {
 *     id: spanner.int(8),
 *     name: null
 *   },
 *   types: {
 *     id: 'int64',
 *     name: 'string'
 *   }
 * };
 *
 * database.run(query, function(err, rows) {});
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.run(query).then(function(data) {
 *   const rows = data[0];
 * });
 *
 * @example <caption>include:samples/crud.js</caption>
 * region_tag:spanner_query_data
 * Full example:
 *
 * @example <caption>include:samples/indexing.js</caption>
 * region_tag:spanner_query_data_with_index
 * Querying data with an index:
 */
Database.prototype.run = function(query, options, callback) {
  const rows = [];

  if (is.fn(options)) {
    callback = options;
    options = null;
  }

  this.runStream(query, options)
    .on('error', callback)
    .on('data', function(row) {
      rows.push(row);
    })
    .on('end', function() {
      callback(null, rows);
    });
};

/**
 * Create a readable object stream to receive resulting rows from a SQL
 * statement.
 *
 * Wrapper around {@link v1.SpannerClient#executeStreamingSql}.
 *
 * @see {@link v1.SpannerClient#executeStreamingSql}
 * @see [Query Syntax](https://cloud.google.com/spanner/docs/query-syntax)
 * @see [ExecuteSql API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.v1#google.spanner.v1.Spanner.ExecuteSql)
 *
 * @param {string|object} query A SQL query or query object. See an
 *     [ExecuteSqlRequest](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.v1#google.spanner.v1.ExecuteSqlRequest)
 *     object.
 * @param {object} [query.params] A map of parameter name to values.
 * @param {object} [query.types] A map of parameter types.
 * @param {DatabaseRunRequest} [options] [Transaction options](https://cloud.google.com/spanner/docs/timestamp-bounds).
 * @returns {ReadableStream} A readable stream that emits rows.
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * const query = 'SELECT * FROM Singers';
 *
 * database.runStream(query)
 *   .on('error', function(err) {})
 *   .on('data', function(row) {
 *     // row = [
 *     //   {
 *     //     name: 'SingerId',
 *     //     value: '1'
 *     //   },
 *     //   {
 *     //     name: 'Name',
 *     //     value: 'Eddie Wilson'
 *     //   }
 *     // ]
 *   // ]
 *   })
 *   .on('end', function() {
 *     // All results retrieved.
 *   });
 *
 * //-
 * // Rows are returned as an array of objects. Each object has a `name` and
 * // `value` property. To get a serialized object, call `toJSON()`.
 * //-
 * database.runStream(query)
 *   .on('error', function(err) {})
 *   .on('data', function(row) {
 *     // row.toJSON() = {
 *     //   SingerId: '1',
 *     //   Name: 'Eddie Wilson'
 *     // }
 *   })
 *   .on('end', function() {
 *     // All results retrieved.
 *   });
 *
 * //-
 * // Alternatively, set `query.json` to `true`, and this step will be performed
 * // automaticaly.
 * //-
 * query.json = true;
 *
 * database.runStream(query)
 *   .on('error', function(err) {})
 *   .on('data', function(row) {
 *     // row = {
 *     //   SingerId: '1',
 *     //   Name: 'Eddie Wilson'
 *     // }
 *   })
 *   .on('end', function() {
 *     // All results retrieved.
 *   });
 *
 * //-
 * // The SQL query string can contain parameter placeholders. A parameter
 * // placeholder consists of '@' followed by the parameter name.
 * //-
 * const query = {
 *   sql: 'SELECT * FROM Singers WHERE name = @name',
 *   params: {
 *     name: 'Eddie Wilson'
 *   }
 * };
 *
 * database.runStream(query)
 *   .on('error', function(err) {})
 *   .on('data', function(row) {})
 *   .on('end', function() {});
 *
 * //-
 * // If you need to enforce a specific param type, a types map can be provided.
 * // This is typically useful if your param value can be null.
 * //-
 * const query = {
 *   sql: 'SELECT * FROM Singers WHERE name = @name',
 *   params: {
 *     name: 'Eddie Wilson'
 *   },
 *   types: {
 *     name: 'string'
 *   }
 * };
 *
 * database.runStream(query)
 *   .on('error', function(err) {})
 *   .on('data', function(row) {})
 *   .on('end', function() {});
 *
 * //-
 * // If you anticipate many results, you can end a stream early to prevent
 * // unnecessary processing and API requests.
 * //-
 * database.runStream(query)
 *   .on('data', function(row) {
 *     this.end();
 *   });
 */
Database.prototype.runStream = function(query, options) {
  const self = this;

  if (is.string(query)) {
    query = {
      sql: query,
    };
  }

  const reqOpts = codec.encodeQuery(query);

  if (options) {
    reqOpts.transaction = {
      singleUse: {
        readOnly: TransactionRequest.formatTimestampOptions_(options),
      },
    };
  }

  delete reqOpts.json;
  delete reqOpts.jsonOptions;

  function makeRequest(resumeToken) {
    return self.pool_.requestStream({
      client: 'SpannerClient',
      method: 'executeStreamingSql',
      reqOpts: extend(reqOpts, {resumeToken}),
    });
  }

  return new PartialResultStream(makeRequest, {
    json: query.json,
    jsonOptions: query.jsonOptions,
  });
};

/**
 * A function to execute in the context of a transaction.
 * @callback RunTransactionCallback
 * @param {?Error} err An error returned while making this request.
 * @param {Transaction} transaction The transaction object. The transaction has
 *     already been created, and is ready to be queried and committed against.
 */
/**
 * A transaction in Cloud Spanner is a set of reads and writes that execute
 * atomically at a single logical point in time across columns, rows, and tables
 * in a database.
 *
 * Note that Cloud Spanner does not support nested transactions. If a new
 * transaction is started inside of the run function, it will be an independent
 * transaction.
 *
 * The callback you provide to this function will become the "run function". It
 * will be executed with either an error or a {@link Transaction}
 * object. The Transaction object will let you run queries and queue mutations
 * until you are ready to {@link Transaction#commit}.
 *
 * In the event that an aborted error occurs, we will re-run the `runFn` in its
 * entirety. If you prefer to handle aborted errors for yourself please refer to
 * {@link Database#getTransaction}.
 *
 * For a more complete listing of functionality available to a Transaction, see
 * the {@link Transaction} API documentation. For a general overview of
 * transactions within Cloud Spanner, see
 * [Transactions](https://cloud.google.com/spanner/docs/transactions) from the
 * official Cloud Spanner documentation.
 *
 * @see [Transactions](https://cloud.google.com/spanner/docs/transactions)
 * @see [Timestamp Bounds](https://cloud.google.com/spanner/docs/timestamp-bounds)
 *
 * @param {TransactionOptions} [options] [Transaction options](https://cloud.google.com/spanner/docs/timestamp-bounds).
 * @param {RunTransactionCallback} callback A function to execute in the context
 *     of a transaction.
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.runTransaction(function(err, transaction) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   // Run a transactional query.
 *   transaction.run('SELECT * FROM Singers', function(err, rows) {
 *     if (err) {
 *       // Error handling omitted.
 *     }
 *
 *     // Queue a mutation (note that there is no callback passed to `insert`).
 *     transaction.insert('Singers', {
 *       SingerId: 'Id3b',
 *       Name: 'Joe West'
 *     });
 *
 *     // Commit the transaction.
 *     transaction.commit(function(err) {
 *       if (!err) {
 *         // Transaction committed successfully.
 *       }
 *     });
 *   });
 * });
 *
 * //-
 * // For read-only transactions, use the `transaction.end()` function to
 * // release the transaction.
 * //-
 * const options = {
 *   readOnly: true,
 *   strong: true
 * };
 *
 * database.runTransaction(options, function(err, transaction) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   transaction.run('SELECT * FROM Singers', function(err, rows) {
 *     if (err) {
 *       // Error handling omitted.
 *     }
 *
 *     // End the transaction. Note that no callback is provided.
 *     transaction.end();
 *   });
 * });
 *
 * @example <caption>include:samples/transaction.js</caption>
 * region_tag:spanner_read_only_transaction
 * Read-only transaction:
 *
 * @example <caption>include:samples/transaction.js</caption>
 * region_tag:spanner_read_write_transaction
 * Read-write transaction:
 */
Database.prototype.runTransaction = function(options, runFn) {
  if (is.fn(options)) {
    runFn = options;
    options = null;
  }

  options = extend({}, options);

  this.getTransaction(options, function(err, transaction) {
    if (err) {
      runFn(err);
      return;
    }

    transaction.beginTime_ = Date.now();
    transaction.runFn_ = runFn;

    if (options && options.timeout) {
      transaction.timeout_ = options.timeout;
      delete options.timeout;
    }

    runFn(null, transaction);
  });
};

/**
 * Get a reference to a Table object.
 *
 * @throws {Error} If a name is not provided.
 *
 * @param {string} name The name of the table.
 * @return {Table} A Table object.
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * const table = database.table('Singers');
 */
Database.prototype.table = function(name) {
  if (!name) {
    throw new Error('A name is required to access a Table object.');
  }

  return new Table(this, name);
};

/**
 * Update the schema of the database by creating/altering/dropping tables,
 * columns, indexes, etc.
 *
 * This method immediately responds with an Operation object. Register event
 * handlers for the "error" and "complete" events to see how the operation
 * finishes. Follow along with the examples below.
 *
 * Wrapper around {@link v1.DatabaseAdminClient#updateDatabaseDdl}.
 *
 * @see {@link v1.DatabaseAdminClient#updateDatabaseDdl}
 * @see [Data Definition Language (DDL)](https://cloud.google.com/spanner/docs/data-definition-language)
 * @see [Schema and Data Model](https://cloud.google.com/spanner/docs/schema-and-data-model)
 * @see [UpdateDatabaseDdl API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.admin.database.v1#google.spanner.admin.database.v1.UpdateDatabaseDdlRequest)
 *
 * @param {string|string[]|object} statements An array of database DDL
 *     statements, or an
 *     [`UpdateDatabaseDdlRequest` object](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.admin.database.v1#google.spanner.admin.database.v1.UpdateDatabaseDdlRequest).
 * @param {LongRunningOperationCallback} [callback] Callback function.
 * @returns {Promise<LongRunningOperationResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * const statements = [
 *   'CREATE TABLE Singers (' +
 *   '  SingerId INT64 NOT NULL,' +
 *   '  FirstName STRING(1024),' +
 *   '  LastName STRING(1024),' +
 *   '  SingerInfo BYTES(MAX),' +
 *   ') PRIMARY KEY(SingerId)'
 * ];
 *
 * database.updateSchema(statements, function(err, operation, apiResponse) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   operation
 *     .on('error', function(err) {})
 *     .on('complete', function() {
 *       // Database schema updated successfully.
 *     });
 * });
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.updateSchema(statements)
 *   .then(function(data) {
 *     const operation = data[0];
 *     return operation.promise();
 *   })
 *   .then(function() {
 *     // Database schema updated successfully.
 *   });
 *
 * @example <caption>include:samples/schema.js</caption>
 * region_tag:spanner_add_column
 * Adding a column:
 *
 * @example <caption>include:samples/indexing.js</caption>
 * region_tag:spanner_create_index
 * Creating an index:
 *
 * @example <caption>include:samples/indexing.js</caption>
 * region_tag:spanner_create_storing_index
 * Creating a storing index:
 */
Database.prototype.updateSchema = function(statements, callback) {
  if (!is.object(statements)) {
    statements = {
      statements: arrify(statements),
    };
  }

  const reqOpts = extend(
    {
      database: this.formattedName_,
    },
    statements
  );

  return this.request(
    {
      client: 'DatabaseAdminClient',
      method: 'updateDatabaseDdl',
      reqOpts: reqOpts,
    },
    callback
  );
};

/**
 * @typedef {array} CreateSessionResponse
 * @property {Session} 0 The newly created session.
 * @property {object} 2 The full API response.
 */
/**
 * @callback CreateSessionCallback
 * @param {?Error} err Request error, if any.
 * @param {Session} session The newly created session.
 * @param {object} apiResponse The full API response.
 */
/**
 * Create a new session, which can be used to perform transactions that read
 * and/or modify data.
 *
 * Sessions can only execute one transaction at a time. To execute multiple
 * concurrent read-write/write-only transactions, create multiple sessions.
 * Note that standalone reads and queries use a transaction internally, and
 * count toward the one transaction limit.
 *
 * **It is unlikely you will need to interact with sessions directly. By
 * default, sessions are created and utilized for maximum performance
 * automatically.**
 *
 * Wrapper around {@link v1.SpannerClient#createSession}.
 *
 * @see {@link v1.SpannerClient#createSession}
 * @see [CreateSession API Documentation](https://cloud.google.com/spanner/docs/reference/rpc/google.spanner.v1#google.spanner.v1.Spanner.CreateSession)
 *
 * @param {object} [options] Configuration object.
 * @param {CreateSessionCallback} [callback] Callback function.
 * @returns {Promise<CreateSessionResponse>}
 *
 * @example
 * const Spanner = require('@google-cloud/spanner');
 * const spanner = new Spanner();
 *
 * const instance = spanner.instance('my-instance');
 * const database = instance.database('my-database');
 *
 * database.createSession(function(err, session, apiResponse) {
 *   if (err) {
 *     // Error handling omitted.
 *   }
 *
 *   // `session` is a Session object.
 * });
 *
 * //-
 * // If the callback is omitted, we'll return a Promise.
 * //-
 * database.createSession().then(function(data) {
 *   const session = data[0];
 *   const apiResponse = data[1];
 * });
 */
Database.prototype.createSession = function(options, callback) {
  const self = this;

  if (is.function(options)) {
    callback = options;
    options = {};
  }

  options = options || {};

  const reqOpts = {
    database: this.formattedName_,
  };

  this.request(
    {
      client: 'SpannerClient',
      method: 'createSession',
      reqOpts: reqOpts,
      gaxOpts: options,
    },
    function(err, resp) {
      if (err) {
        callback(err, null, resp);
        return;
      }

      const session = self.session_(resp.name);
      session.metadata = resp;

      callback(null, session, resp);
    }
  );
};

/**
 * Create a Session object.
 *
 * It is unlikely you will need to interact with sessions directly. By default,
 * sessions are created and utilized for maximum performance automatically.
 *
 * @private
 *
 * @param {string} [name] The name of the session. If not provided, it is
 *     assumed you are going to create it.
 * @returns {Session} A Session object.
 *
 * @example
 * const session = database.session_('session-name');
 */
Database.prototype.session_ = function(name) {
  return new Session(this, name);
};

/*! Developer Documentation
 *
 * All async methods (except for streams) will return a Promise in the event
 * that a callback is omitted.
 */
promisifyAll(Database, {
  exclude: [
    'batchTransaction',
    'getMetadata',
    'runTransaction',
    'table',
    'updateSchema',
    'session_',
  ],
});

/**
 * Reference to the {@link Database} class.
 * @name module:@google-cloud/spanner.Database
 * @see Database
 */
module.exports = Database;
