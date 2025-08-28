const app=require('./app')
const mongoose=require('mongoose')

const port=8000
mongoose.connect('mongodb://localhost:27017/lms').then(()=>{
    console.log("database connected")
}).catch((err)=>console.log(err))



app.listen(port,()=>{
    console.log("server has been connected")
})