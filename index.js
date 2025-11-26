require('dotenv').config();
const express = require('express')
const cors = require('cors')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express()

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// const { default: home } = require('./home');
const port = process.env.PORT || 3000

//firebase admin 
const admin = require("firebase-admin");
const serviceAccount = require("./firebase-admin.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


function generateTrackingId() {
    const prefix = "BEX";  // brand short code (Bangla Express)
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const timePart = Date.now().toString().slice(-6); 
    return `${prefix}-${randomPart}-${timePart}`;
}

// // Another Generator  juanker mahabub sir 
// const crypto = require("crypto");
// function generateTrackingId() {
//   const prefix = "PRCL"; // your brand prefix
//   const date = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
//   const random = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6-char random hex
//   return `${prefix}-${date}-${random}`;
// }


// medilayer //
app.use(express.json());
app.use(cors());

const varifyFBToken = async (req, res, next) =>{
  // console.log('header in the medilayer', req.headers.authorization);
  const token = req.headers.authorization;
  
  if(!token){
    return res.status(401).send({message: 'unauthorized access'})
  }
   try{
      const IdToken = token.split(" ")[1];
      const decoded = await admin.auth().verifyIdToken(IdToken);
      console.log("decoded the token", decoded);
      req.decoded_email = decoded.email;
      next();
   }
   catch(err){
      return res.status(401).send({message: 'unauthorized access'})
   }
}

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
    customer_email: paymentInfo.customerEmail,
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
  const trackingId = generateTrackingId();
  const transactionId = session.payment_intent;
  const query = {transactionId: transactionId};
  const paymentExist = await paymentCollection.findOne(query);
  if(paymentExist){
    return res.send({
      message: 'already exist', 
      transactionId,
      trackingId: paymentExist.trackingId,
    })
  }

  console.log('session', session);
  if(session.payment_status === 'paid'){
    const Id = session.metadata.parcleId;
    const query = { _id: new ObjectId(Id)}
    const update ={
      $set: {
        paymentStatus:  'paid',
        trackingId:  trackingId,
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
      trackingId:  trackingId,
      
    }
    if(session.payment_status === 'paid'){
      const resultPayment = await paymentCollection.insertOne(payment)
      res.send({
        success: true, 
        modifyParcle: result,
        trackingId:  trackingId,
        transactionId: session.payment_intent,
        paymentInfo: resultPayment,
      })
    }
  }
  res.send({success: false})
})

// payment histary api 
app.get('/payments', varifyFBToken, async(req, res)=>{
  const email = req.query.email;
  const query = {};
  if(email){
    query.customerEmail = email
  }

  if(email !== req.decoded_email){
    return res.status(403).send({message: "forbidden access"})
  }
   const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
  const result = await cursor.toArray();

  res.send(result);
})


 // Send a ping to confirm a successful connection ===================================
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally { // Ensures that the client will close when you finish/error 
  }
}
run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Bangla Express server is raning.....!')
 
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
