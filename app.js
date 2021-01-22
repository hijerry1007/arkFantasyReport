const express = require('express');
const handlebars = require('express-handlebars');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const axios = require('axios').default;
const request = require("request");
const cheerio = require("cheerio");
const moment = require('moment');
const puppeteer = require('puppeteer');

app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.engine('handlebars', handlebars({
    defaultLayout: 'main',
    helpers: require('./config/handlebars-helpers')
}));
app.set('view engine', 'handlebars');
app.use(express.static('public'));


app.get("/", async (req, res) => {
    const browser = await puppeteer.launch({executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
    const page = await browser.newPage();
    const baseURL = 'https://www.nba.com/games';
    const boxURL = await fetchBoxURL(baseURL);
    for ( let i = 0 ; i < boxURL.length ; i++){
        await page.goto(boxURL[i], {waitUntil: 'networkidle2'});
        const tds = await page.$$eval('td', tds => {
            const count = tds.length / 21;
            const rows = [];
            for (let j = 0 ; j < tds.length; j++){
                if(tds[j].innerText.indexOf('DNP') !== -1 ){
                    j += 19;
                    continue;
                }
                rows.push()
            }
            return tds[10].innerText
        });
        console.log(tds)
    }
    await browser.close();

    const games = ["1"];
    res.render("home", {games: games});
})

app.get("/hot", (req, res) => {

    const options = {
        method: 'GET',
        url: 'https://stats.nba.com/js/data/widgets/home_daily.json',
      };
    axios.request(options).then(function (response) {
        const items = response.data.items[0].items;
        res.render("hot", {items: items});
    }).catch(function (error) {
        console.error(error);
    });
})


app.listen(process.env.PORT || port, () => console.log(`Example app listening on port ${port}!`));

function fetchBoxURL (baseURL){

    const options = {
        method: 'GET',
        url: baseURL
    };
    return new Promise((resolve, reject)=>{
        request(options, function (error, response, body) {
            if (error || !body) {
                reject();
            }
            const $ = cheerio.load(body);
            const boxURL = []; 
            const aTag = $('a');
            for ( let i = 0 ; i < aTag.length ; i++){
                if(aTag[i].attribs['data-text'] == 'BOX SCORE'){
                    const newURL = 'https://www.nba.com';
                    boxURL.push(newURL + aTag[i].attribs['href'])
                }
            }
            resolve(boxURL);
        });
    })
}

function fetchTable(baseURL,url){

    const options = {
        method: 'GET',
        url: baseURL + url,
    }

    console.log(options.url)
    request(options, function(error, response, body){
        if (error || !body) {
            return;
        }
        const $ = cheerio.load(body);
        const tbody = Array.from($(".relative").find('tbody'));

        tbody.forEach(element => {
            const tr = Array.from(element.find('tr'));
            tr.forEach(e =>{
                console.log(e.text())
            })
        })
    })
    
}