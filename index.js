const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

//Middleware
app.use(cors());
app.use(express.json());

//MongoDB Connection

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.igno3bw.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // all collection in database
    const userCollection = client.db('forumFlareDB').collection('users');
    const postCollection = client.db('forumFlareDB').collection('posts');
    const tagCollection = client.db('forumFlareDB').collection('tags');

    // user related api
    app.post('/users', async (req, res) => {
      const user = req.body;
      //user existing checking
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: 'User already exist', insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // posts related api
    app.get('/posts', async (req, res) => {
      const tag = req.query.tag;
      let query = {};
      if (tag) {
        query = { tags: { $regex: new RegExp(tag, 'i') } };
      }
      const result = await postCollection
        .find(query)
        .sort({ time: -1 })
        .toArray();
      res.send(result);
    });

    //tag name related api
    app.get('/tags', async (req, res) => {
      const result = await tagCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Forum Flare is Running');
});

app.listen(port, () => {
  console.log(`Forum Flare is running on port: ${port}`);
});
