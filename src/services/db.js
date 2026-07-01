const mysql = require('mysql2/promise');

// MySQL connection pool — single global instance.
// Uses a pool (not a single connection) so concurrent requests
// each get their own connection from the pool automatically.
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000,
});

// Verify connectivity once at startup
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Successfully connected to MySQL!');
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
  }
}

testConnection();

module.exports = pool;
