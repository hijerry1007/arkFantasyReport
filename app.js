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
const db = require('./models');
const { all } = require('sequelize/types/lib/operators');
const gameRecord = db.gameRecord;
const statisTitle = db.StatisTitle;

app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.engine('handlebars', handlebars({
    defaultLayout: 'main',
    helpers: require('./config/handlebars-helpers')
}));
app.set('view engine', 'handlebars');
app.use(express.static('public'));


app.get("/fetchData", async (req, res) => {
    try {
        const browser = await puppeteer.launch({ executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" });
        const page = await browser.newPage();
        const baseURL = 'https://www.nba.com/games';
        const boxURL = await fetchBoxURL(baseURL);
        const today = moment().format('YYYY-MM-DD');
        let bigData = {};
        let rows = [];
        const table = await statisTitle.findOne({ where: { id: 1 } }).then(title => title.get());
        const title = JSON.parse(table.title);
        const thLength = title.length;
        for (let i = 0; i < boxURL.length; i++) {
            await page.goto(boxURL[i]);
            await page.waitForSelector('td', { timeout: 30000 });

            let tds = await page.$$eval('td', (tds, thLength) => {
                let _rows = [];
                for (let j = 0; j < tds.length; j++) {
                    let tdText = tds[j].innerText;
                    if (tdText.indexOf('DNP') !== -1 || tdText.indexOf('Injury') !== -1 || tdText.indexOf('Illness') !== -1 || tdText.indexOf('NWT') !== -1) {
                        _rows.pop();
                        continue;
                    } else if (tdText.indexOf('TOTALS') !== -1) {
                        j += thLength - 1;
                        continue;
                    }
                    else {
                        let index = tdText.indexOf('\n');
                        if (index !== -1) {
                            tdText = tdText.substring(0, index);
                        }
                        _rows.push(tdText);
                    }
                }
                return _rows;
            }, thLength);
            rows.push(tds);
        }
        await browser.close();
        bigData.data = rows;
        bigData = JSON.stringify(bigData);
        gameRecord.findOne({ where: { gameDate: today } })
            .then(record => {
                if (!record) {
                    gameRecord.create({
                        gameDate: today,
                        bigData: bigData,
                    }).then(record => record);
                } else {
                    record.bigData = bigData;
                    return record.save();
                }

            })
            .then(record => res.render("home"))
    } catch (error) {
        console.log(error);
    }
});

app.get("/fetchTableHead", async (req, res) => {
    try {
        const browser = await puppeteer.launch({ executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" });
        const page = await browser.newPage();
        const baseURL = 'https://www.nba.com/games';
        const boxURL = await fetchBoxURL(baseURL);
        await page.goto(boxURL[0]); //找一個box抓就好
        await page.waitForSelector('th', { timeout: 30000 });

        let tableHead = await page.$$eval('th', ths => {
            const rows = [];
            for (let i = 0; i < ths.length / 2; i++) {
                rows.push(ths[i].innerText);
            }
            return rows;
        });
        tableHead = JSON.stringify(tableHead);
        statisTitle.findOne({ where: { id: 1 } }).then(title => {
            if (title) {
                title.title = tableHead;
                return title.save();
            } else {
                statisTitle.create({
                    title: tableHead
                }).then(title => title)
            }
        })
            .then(title => res.render("home"));
    } catch (error) {
        console.log(error);
    }
})

app.get("/hot", (req, res) => {

    const options = {
        method: 'GET',
        url: 'https://stats.nba.com/js/data/widgets/home_daily.json',
    };
    axios.request(options).then(function (response) {
        const items = response.data.items[0].items;
        res.render("hot", { items: items });
    }).catch(function (error) {
        console.error(error);
    });
});

app.get("/dailyReport", (req, res) => {
    const today = moment().format('YYYY-MM-DD');
    gameRecord.findOne({ where: { gameDate: today } })
        .then((result) => {
            if (!result){
                console.log("error, no data");
            }
            let bigData = result.bigData;
            let data = handleBigData(bigData);

            res.render("dailyReport", { data: data });


        })
})


app.listen(process.env.PORT || port, () => console.log(`Example app listening on port ${port}!`));

function fetchBoxURL(baseURL) {

    const options = {
        method: 'GET',
        url: baseURL
    };
    return new Promise((resolve, reject) => {
        request(options, function (error, response, body) {
            if (error || !body) {
                reject();
            }
            const $ = cheerio.load(body);
            const boxURL = [];
            const aTag = $('a');
            for (let i = 0; i < aTag.length; i++) {
                if (aTag[i].attribs['data-text'] == 'BOX SCORE') {
                    const newURL = 'https://www.nba.com';
                    boxURL.push(newURL + aTag[i].attribs['href'])
                }
            }
            resolve(boxURL);
        });
    })
}


async function handleBigData(bigData) {
    const table = await statisTitle.findOne({ where: { id: 1 } }).then(title => title.get());
    const title = JSON.parse(table.title);
    const tableLength = title.length;
    const data = [];
    for (let i = 0; i < bigData.length; i++) {
        let gameStatis = bigData[i];
        while(gameStatis.length > 0 ){
            let statis = gameStatis.splice(0, tableLength);
            let playerStatis = await getPlayerData(title, statis);
            data.push(playerStatis);
        }
    }
    return data;
}

function getPlayerData (title, statis){
    return new Promise((resolve, reject) => {
        const playerStatis = {}
        let count = 0;
        for (let i = 0 ; i < title.length ; i++){
            let _title = title[i];
            let _statis = statis[i];
            switch(_title){
                case "PTS":
                    if(_statis > 9) count++;
                    break;
                case "REB":
                    if(_statis > 9) count++;
                    break;
                case "AST":
                    if(_statis > 9) count++;
                    break;
                case "STL":
                    if(_statis > 9) count++;
                    break;
                case "BLK":
                    if(_statis > 9) count++;
                    break;
                default:
                    break;
            }
            playerStatis[_title] = _statis;
        }
        
        if(count === 0 || count === 1){
            playerStatis.performance = "single";
        }else if (count === 2){
            playerStatis.performance = "doubleDouble";
        }else if (count === 3){
            playerStatis.performance = "tripleDouble";
        }else if (count === 4){
            playerStatis.performance = "quadrupleDouble";
        }else if (count === 5){
            playerStatis.performance = "fiveDouble";
        }
    
        resolve(playerStatis)
    })
}