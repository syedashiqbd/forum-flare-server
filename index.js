const express = require('express');
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
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
    const commentCollection = client.db('forumFlareDB').collection('comments');
    const announcementCollection = client
      .db('forumFlareDB')
      .collection('announcements');

    // jwt related api
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1h',
      });
      res.send({ token });
    });

    // middlewares for verifyToken
    const verifyToken = (req, res, next) => {
      // console.log('inside verifyToken:', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
          return res.status(401).send({ message: 'unauthorized access' });
        }
        req.decoded = decoded;
        next();
      });
    };

    // middleware for verify admin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === 'admin';
      if (!isAdmin) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    };

    // user related api
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

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

    //user info from two collection based on email
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const result = await userCollection
        .aggregate([
          {
            $match: {
              email: email,
            },
          },
          {
            $lookup: {
              from: 'posts',
              localField: 'email',
              foreignField: 'email',
              as: 'userPost',
            },
          },
        ])

        .toArray();
      res.send(result[0]);
    });

    //admin related api
    // for making change role to admin
    app.patch(
      '/users/admin/:id',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: 'admin',
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    // check user admin or not
    app.get('/users/admin/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: 'forbidden access' });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);

      let admin = false;
      if (user) {
        admin = user?.role === 'admin';
      }
      res.send({ admin });
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
        .skip(page * limit)
        .limit(limit)
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
        .skip(page * limit)
        .limit(limit)
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

    app.post('/posts', async (req, res) => {
      const query = req.body;
      const result = await postCollection.insertOne(query);
      res.send(result);
    });

    app.delete('/post/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await postCollection.deleteOne(query);
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

    // comments related api
    app.post('/comment', async (req, res) => {
      const item = req.body;
      const result = await commentCollection.insertOne(item);
      res.send(result);
    });

    app.get('/comment/:id?', async (req, res) => {
      const postId = req.params.id;

      // Check if postId is provided
      if (postId) {
        // If postId is provided, retrieve comments for that post
        const query = { postId: postId };
        const result = await commentCollection.find(query).toArray();
        res.send(result);
      } else {
        // If postId is not provided, retrieve all comments
        const allComments = await commentCollection
          .find({ feedback: { $exists: true } })
          .toArray();
        res.send(allComments);
      }
    });

    // update feedback and report for a comment
    app.patch('/comments/:id/feedback', async (req, res) => {
      const commentId = req.params.id;
      const { feedback } = req.body;

      const result = await commentCollection.updateOne(
        { _id: new ObjectId(commentId) },
        {
          $set: {
            feedback,
            reported: true,
          },
        }
      );
      res.send(result);
    });

    // update action and report for a comment
    app.patch('/comments/:id/action', async (req, res) => {
      const commentId = req.params.id;
      const { action } = req.body;

      const result = await commentCollection.updateOne(
        { _id: new ObjectId(commentId) },
        {
          $set: {
            action,
          },
        }
      );
      res.send(result);
    });

    //announcement api
    app.post('/announcement', async (req, res) => {
      const item = req.body;
      const result = await announcementCollection.insertOne(item);
      res.send(result);
    });

    app.get('/announcement', async (req, res) => {
      const result = await announcementCollection.find().toArray();
      res.send(result);
    });

    //admin-stats
    app.get('/admin-stats', verifyToken, verifyAdmin, async (req, res) => {
      const posts = await postCollection.estimatedDocumentCount();
      const comments = await commentCollection.estimatedDocumentCount();
      const users = await userCollection.estimatedDocumentCount();

      res.send({ posts, comments, users });
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
