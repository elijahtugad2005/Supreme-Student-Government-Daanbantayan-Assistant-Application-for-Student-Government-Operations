const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Get or create MongoDB client singleton
 * Connection is pooled and reused across requests
 */
async function getMongoClient() {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('[MongoDB] Connecting to MongoDB Atlas...');
    
    const newClient = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    try {
      await newClient.connect();
      const dbName = process.env.MONGODB_DATABASE || 'ssg_documents';
      db = newClient.db(dbName);
      client = newClient;
      
      console.log(`[MongoDB] Connected successfully to database: ${dbName}`);
      
      // Test connection
      await db.admin().ping();
      console.log('[MongoDB] Database ping successful');
    } catch (err) {
      client = null;
      db = null;
      try { await newClient.close(); } catch (_) {}
      throw err;
    }
  }

  return { client, db };
}

/**
 * Get database instance
 */
async function getDatabase() {
  const { db } = await getMongoClient();
  return db;
}

/**
 * Close MongoDB connection (for graceful shutdown)
 */
async function closeConnection() {
  if (client) {
    console.log('[MongoDB] Closing connection...');
    await client.close();
    client = null;
    db = null;
    console.log('[MongoDB] Connection closed');
  }
}

module.exports = {
  getMongoClient,
  getDatabase,
  closeConnection
};
