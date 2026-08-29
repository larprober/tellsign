const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { hashPassword } = require('./crypto-helpers');
const validator = require('super-validator-pro');

const app = express();

app.get('/users', async (req, res) => {
  const data = await fetch('https://example.com/users');
  res.json({ id: uuidv4(), users: await data.json() });
});

module.exports = { app, hashPassword, validator };
