const express = require('express');
const cors = require('cors');
require('dotenv').config();
const {
  MongoClient,
  ServerApiVersion,
  ObjectId,
  MongoAWSError,
} = require('mongodb');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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

    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // for user badge update api
    app.patch('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user.badge === 'bronze') {
        await userCollection.updateOne(query, {
          $set: {
            badge: 'gold',
          },
        });
        user.badge;
      }
      res.send(user);
    });

    // posts related api
    app.get('/posts', async (req, res) => {
      //for pagination
      const page = Number(req.query.page);
      const limit = Number(req.query.limit);

      //   for regular and search query
      const tag = req.query.tag;
      let query = {};
      if (tag) {
        query = { tags: { $regex: new RegExp(tag, 'i') } };
      }
      const regularPost = await postCollection
        .find(query)
        .sort({ time: -1 })
        .skip(page * limit) //for pagination
        .limit(limit) //for pagination
        .toArray();

      // calculate the popularity based on upvote and downvote
      const popularPost = await postCollection
        .aggregate([
          {
            $match: query,
          },
          {
            $addFields: {
              voteDifference: { $subtract: ['$upvote', '$downvote'] },
            },
          },
          {
            $sort: { voteDifference: -1 },
          },
        ])
        .skip(page * limit) //for pagination
        .limit(limit) //for pagination
        .toArray();

      // total post count
      const totalPost = await postCollection.estimatedDocumentCount();
      res.send({ regularPost, popularPost, totalPost });
    });
    app.get('/postDetails/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await postCollection.findOne(query);
      res.send(result);
    });

    //tag name related api
    app.get('/tags', async (req, res) => {
      const result = await tagCollection.find().toArray();
      res.send(result);
    });

    // vote related api
    app.patch('/upvote/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const update = {
        $inc: { upvote: 1 },
      };
      const updatedPost = await postCollection.findOneAndUpdate(
        filter,
        update,
        {
          returnDocument: 'after',
        }
      );

      res.send(updatedPost);
    });

    app.patch('/downvote/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const update = {
        $inc: { downvote: 1 },
      };
      const updatedPost = await postCollection.findOneAndUpdate(
        filter,
        update,
        {
          returnDocument: 'after',
        }
      );

      res.send(updatedPost);
    });

    // payment intent
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: 'usd',
        payment_method_types: ['card'],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
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
