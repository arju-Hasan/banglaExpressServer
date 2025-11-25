require('dotenv').config();
const express = require('express')
const cors = require('cors')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express()

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// const { default: home } = require('./home');
const port = process.env.PORT || 3000


// medilayer 
app.use(express.json());
app.use(cors());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.rzhc4zj.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();


    const db = client.db('bangla_express_db');
    const parcleCollection = db.collection('parcles');
    const paymentCollection = db.collection('payments');



    // =============== parcles api ===============
    app.get('/parcles', async (req, res) =>{
      const query ={}
      const {email} = req.query;
      if(email){
        query.SenderEmail = email;
      }      
      // sort by new 
      const options = {sort : {createdAt: -1}}
      const cursor = parcleCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/parcles/:id', async(req, res) =>{
       const id = req.params.id;
      const query = { _id: new ObjectId(id)};
      const result = await parcleCollection.findOne(query);
      res.send(result)
    })

    app.post('/parcles', async (req, res)=>{
        const parcle = req.body;
        // parcle send time 
       parcle.createdAt = new Date();
        const result = await parcleCollection.insertOne(parcle);
        res.send(result)
        } )

    app.delete('/parcles/:id', async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id)};
      const result = await parcleCollection.deleteOne(query);
      res.send(result)
    })  

    // ============== payment Api =================
    app.post('/create-checkout-session', async (req, res) => {
    const paymentInfo = req.body;
    const amount = parseInt(paymentInfo.cost)*100
    const session = await stripe.checkout.sessions.create({
    line_items: [
      {
       price_data: {
        currency: 'USD',
        unit_amount: amount,
        product_data: {
          name: paymentInfo.parcleName
        }
       },
         quantity: 1       
      },
    ],
    mode: 'payment',
    metadata:{
      parcleId: paymentInfo.parcleId,
      parcleName: paymentInfo.parcleName
    },
    success_url: `${process.env.MY_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.MY_DOMAIN}/dashboard/payment-cancelled`,
  });

  // res.redirect(303, session.url);
  console.log(session);
  res.send({url: session.url})
});  

app.patch('/payment-success', async (req, res) =>{
  const sessionId = req.query.session_id;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  console.log('session', session);
  if(session.payment_status === 'paid'){
    const Id = session.metadata.parcleId;
    const query = { _id: new ObjectId(Id)}
    const update ={
      $set: {
        paymentStatus:  'paid',

      }
    }
    const result = await parcleCollection.updateOne(query, update);
    const payment ={
      amount: session.amount_total/100,
      currency: session.currency,
      customerEmail: session.customer_email,
      parcleId: session.metadata.parcleId,
      parcleName: session.metadata.parcleName,
      transactionId: session.payment_intent,
      paymentStatus: session.payment_status,
      paidAt : new Date(),
      trackingId:'kiso-akta ' 
    }
    if(session.payment_status === 'paid'){
      const resultPayment = await paymentCollection.insertOne(payment)
      res.send({success: true, modifyParcle: result, paymentInfo: resultPayment})
    }

  }

  res.send({success: false})
})


 // Send a ping to confirm a successful connection ===================================
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Bangla Express server is raning.....!')
 
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
