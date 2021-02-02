const express = require('express');
const handlebars = require('express-handlebars');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const request = require("request");
const cheerio = require("cheerio");
const moment = require('moment');
const puppeteer = require('puppeteer');
const cron = require("node-cron");
const db = require('./models');
const gameRecord = db.gameRecord;
const statisTitle = db.StatisTitle;
const { Client } = require('@line/bot-sdk');
const { middleware } = require('@line/bot-sdk');
const lineConfig = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};
const client = new Client(lineConfig);


let fetchHead = cron.schedule('0 6 * * *', () => {
    fetchTableHead();
}, { timezone: 'Asia/Shanghai' })

let fetchBoxData = cron.schedule('0,30 00,10,12,14 * * *', () => {
    fetchData();
}, { timezone: 'Asia/Shanghai' })

fetchData();
fetchHead.start();
fetchBoxData.start();
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.engine('handlebars', handlebars({
    defaultLayout: 'main',
    helpers: require('./config/handlebars-helpers')
}));
app.set('view engine', 'handlebars');
app.use(express.static('public'));

app.post("/", middleware(lineConfig), async (req, res) => {
    try {
        let result = await req.body.events.map(handleEvent);
        res.json(result);
    } catch (error) {
        console.log(error);
    }
})

app.get("/dailyReport", async (req, res) => {
    const today = moment().format('YYYY-MM-DD');

    gameRecord.findOne({ where: { gameDate: today } })
        .then((result) => {
            if (!result || result.length == 0) {
                console.log("error, no data");
                res.render("dailyReport");
            }
            let bigData = JSON.parse(result.bigData);
            let PTS = bigData.sort((a, b) => b.PTS - a.PTS).slice(0, 5);
            let REB = bigData.sort((a, b) => b.REB - a.REB).slice(0, 5);
            let AST = bigData.sort((a, b) => b.AST - a.AST).slice(0, 5);
            let STL = bigData.sort((a, b) => b.STL - a.STL).slice(0, 5);
            let BLK = bigData.sort((a, b) => b.BLK - a.BLK).slice(0, 5);
            let THREE = bigData.sort((a, b) => b['3PM'] - a['3PM']).slice(0, 5);
            let TO = bigData.sort((a, b) => b.TO - a.TO).slice(0, 5);
            let FT = bigData.sort((a, b) => b.FTA - a.FTA).slice(0, 5);
            let FGA = bigData.sort((a, b) => b.FGA - a.FGA).slice(0, 5);
            let double = [];
            let triple = [];
            let quadra = []
            let five = []
            for (let i = 0; i < bigData.length; i++) {
                switch (bigData[i].performance) {
                    case "doubleDouble":
                        double.push(bigData[i]);
                        break;
                    case "tripleDouble":
                        triple.push(bigData[i]);
                        break;
                    case "quadrupleDouble":
                        quadra.push(bigData[i]);
                        break;
                    case "fiveDouble":
                        five.push(bigData[i]);
                        break;
                    default:
                        break;
                }
            }
            double.sort((a, b) => b.PTS - a.PTS);
            triple.sort((a, b) => b.PTS - a.PTS);
            quadra.sort((a, b) => b.PTS - a.PTS)
            five.sort((a, b) => b.PTS - a.PTS)
            res.render("dailyReport", { PTS, REB, AST, STL, BLK, THREE, TO, FGA, FT, double, triple, quadra, five });
        })
})


app.listen(process.env.PORT || port, () => console.log(`Example app listening on port ${port}!`));


async function fetchTableHead() {
    try {
        const browser = await puppeteer.launch({
            headless: true, args: [
                '--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox', '--hide-scrollbars'
            ]
        });
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
    } catch (error) {
        console.log(error);
    }
}

async function fetchData() {
    try {
        const browser = await puppeteer.launch({
            headless: true, args: [
                '--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox', '--hide-scrollbars'
            ]
        });
        const page = await browser.newPage();
        const baseURL = 'https://www.nba.com/games';
        const boxURL = await fetchBoxURL(baseURL);
        const today = moment().format('YYYY-MM-DD');
        const bigData = [];
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
                    if (tdText.indexOf('DNP') !== -1 || tdText.indexOf('DND') !== -1 || tdText.indexOf('Injury') !== -1 || tdText.indexOf('Illness') !== -1 || tdText.indexOf('NWT') !== -1) {
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
            bigData.push(tds);
        }
        await browser.close();
        let data = await handleBigData(bigData, title);
        data = JSON.stringify(data);
        gameRecord.findOne({ where: { gameDate: today } })
            .then(record => {
                if (!record) {
                    gameRecord.create({
                        gameDate: today,
                        bigData: data,
                    }).then(record => record);
                } else {

                    record.update({
                        gameDate: today,
                        bigData: data
                    })
                    console.log("成功更新資料")
                    return
                }

            })
    } catch (error) {
        console.log(error);
    }
};

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


function handleBigData(bigData, title) {
    return new Promise(async (resolve, reject) => {
        const tableLength = title.length;
        const data = [];
        for (let i = 0; i < bigData.length; i++) {
            let gameStatis = bigData[i];
            while (gameStatis.length > 0) {
                let statis = gameStatis.splice(0, tableLength);
                let playerStatis = await getPlayerData(title, statis);
                data.push(playerStatis);
            }
        }
        resolve(data);
    })
}

function getPlayerData(title, statis) {
    return new Promise((resolve, reject) => {
        const playerStatis = {}
        let count = 0;
        for (let i = 0; i < title.length; i++) {
            let _title = title[i];
            let _statis = statis[i];
            switch (_title) {
                case "PTS":
                    if (_statis > 9) count++;
                    break;
                case "REB":
                    if (_statis > 9) count++;
                    break;
                case "AST":
                    if (_statis > 9) count++;
                    break;
                case "STL":
                    if (_statis > 9) count++;
                    break;
                case "BLK":
                    if (_statis > 9) count++;
                    break;
                default:
                    break;
            }
            playerStatis[_title] = _statis;
        }

        if (count === 0 || count === 1) {
            playerStatis.performance = "single";
        } else if (count === 2) {
            playerStatis.performance = "doubleDouble";
        } else if (count === 3) {
            playerStatis.performance = "tripleDouble";
        } else if (count === 4) {
            playerStatis.performance = "quadrupleDouble";
        } else if (count === 5) {
            playerStatis.performance = "fiveDouble";
        }

        resolve(playerStatis)
    })
}

const handleEvent = (event) => {
    switch (event.type) {
        case 'join': //這隻機器人加入別人的群組
            break;
        case 'follow': //追蹤這隻機器人
            break;
        case 'message': //傳訊息給機器人
            switch (event.message.type) {
                case 'text':
                    textHandler(event.replyToken, event.message.text);   //測試code就不用這行
                    //             return client.replyMessage(replyToken, {     ---->    測試用code通常就是呼叫client.replyMessage，並依api要求格式回傳
                    //                 type: 'text',
                    //                 text: event.message.text  ----> 我們傳給機器人的文字會在這裡面
                    //             });
                    break;
                case 'sticker':
                    // do sth with sticker
                    return
            }
    }
}

const textHandler = (replyToken, inputText) => {
    try {
        let resText;
        switch (inputText) {
            case '你好':
                resText = '你好啊';
                break;
            case 'test':
                resText = `測試`;
                break
            case '賴賴':
                resText = '阿比我愛妳'
            //             case 'Q&A':
            //                 return client.replyMessage(replyToken, imageMap());
            //             case 'q&a':
            //                 return client.replyMessage(replyToken, carousel());
            default:
                resText = '請親臨院所';
        }
        return client.replyMessage(replyToken, {
            type: 'text',
            text: resText
        });
    } catch (err) {
        console.log(err)
    }

}