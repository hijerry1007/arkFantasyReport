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
const line = require('@line/bot-sdk');
const { restart } = require('nodemon');
const lineConfig = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(lineConfig);


let fetchHead = cron.schedule('0 6 * * *', () => {
    fetchTableHead();
}, { timezone: 'Asia/Shanghai' })

let fetchBoxData = cron.schedule('0,30 00,10,12,14,15 * * *', () => {
    fetchData();
}, { timezone: 'Asia/Shanghai' })

fetchHead.start();
fetchBoxData.start();

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
    try {
        let result = await req.body.events.map(handleEvent);
        res.json(result);
    } catch (error) {
        console.log(error);
    }
})

app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.engine('handlebars', handlebars({
    defaultLayout: 'main',
    helpers: require('./config/handlebars-helpers')
}));
app.set('view engine', 'handlebars');
app.use(express.static('public'));

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
            quadra.sort((a, b) => b.PTS - a.PTS);
            five.sort((a, b) => b.PTS - a.PTS);
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
            await page.goto(boxURL[i], { timeout: 60000, waitUntil: 'domcontentloaded' });
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
                    console.log(event.message.text)
                    if (event.message.text == '雙十' || event.message.text == '大三元' || event.message.text == '戰報' || event.message.text == '賴賴') {
                        textHandler(event.replyToken, event.message.text);
                    } else {
                        return
                    }
                    break;
                case 'sticker':
                    // do sth with sticker
                    return
            }
    }
}

const textHandler = async (replyToken, inputText) => {
    try {
        let resText;
        const today = moment().format('YYYY-MM-DD');
        const result = await gameRecord.findOne({ where: { gameDate: today } })

        if (!result || result.length == 0) {
            console.log("error, no data");
            return null
        }
        let bigData = JSON.parse(result.bigData);

        switch (inputText) {
            case '賴賴':
                resText = {
                    "type": "text",
                    "text": '阿比我愛妳'
                };
                break
            case '雙十':
                bigData = bigData.sort((a, b) => b.PTS - a.PTS);
                resText = {
                    "type": "flex",
                    "altText": `${today}NBA戰報`,
                    "contents": {
                        "type": "bubble",
                        "body": {
                            "type": "box",
                            "layout": "vertical",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "今日雙十",
                                    "weight": "bold",
                                    "size": "xl"
                                },
                                {
                                    "type": "box",
                                    "layout": "vertical",
                                    "margin": "lg",
                                    "contents": []
                                }
                            ]
                        }
                    }
                };
                for (let i = 0; i < bigData.length; i++) {
                    if (bigData[i].performance === "doubleDouble") {
                        resText['contents']['body'].contents[1]['contents'].push({
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${bigData[i].PLAYER}`,
                                    "color": "#238aeb",
                                    "size": "lg",
                                    "weight": "bold",
                                }
                            ],
                            "margin": "md"
                        });
                        let statics = `${bigData[i].PTS}分 ${bigData[i].REB}籃板 ${bigData[i].AST}助攻`;
                        if (Number(`${bigData[i].STL}`) >= 2) statics += `${bigData[i].STL}抄截`;
                        if (Number(`${bigData[i].BLK}`) >= 2) statics += `${bigData[i].BLK}鍋`;
                        if (Number(`${bigData[i]['FG%']}`) >= 40) statics += `命中率${bigData[i]['FG%']}%`
                        if (Number(`${bigData[i]['3PM']}`) >= 3) statics += `${bigData[i]['3PM']}三分命中`;
                        resText['contents']['body'].contents[1]['contents'].push(
                            {
                                "type": "box",
                                "layout": "baseline",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": statics,
                                        "wrap": true,
                                        "color": "#223332",
                                        "size": "md"
                                    }
                                ],
                                "margin": "md",
                            }
                        );
                    }
                }
                if (resText['contents']['body'].contents[1]['contents'].length == 0) {
                    resText['contents']['body'].contents[1]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": "無",
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    })
                }
                break
            case '大三元':
                bigData = bigData.sort((a, b) => b.PTS - a.PTS);
                resText = {
                    "type": "flex",
                    "altText": `${today}NBA戰報`,
                    "contents": {
                        "type": "bubble",
                        "body": {
                            "type": "box",
                            "layout": "vertical",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": "今日大三元",
                                    "weight": "bold",
                                    "size": "xl"
                                },
                                {
                                    "type": "box",
                                    "layout": "vertical",
                                    "margin": "lg",
                                    "contents": []
                                }
                            ]
                        }
                    }
                };
                for (let i = 0; i < bigData.length; i++) {
                    if (bigData[i].performance === "tripleDouble") {
                        resText['contents']['body'].contents[1]['contents'].push({
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${bigData[i].PLAYER}`,
                                    "color": "#238aeb",
                                    "size": "lg",
                                    "weight": "bold",
                                }
                            ],
                            "margin": "md"
                        });
                        let statics = `${bigData[i].PTS}分 ${bigData[i].REB}籃板 ${bigData[i].AST}助攻`;
                        if (Number(`${bigData[i].STL}`) >= 2) statics += `${bigData[i].STL}抄截`;
                        if (Number(`${bigData[i].BLK}`) >= 2) statics += `${bigData[i].BLK}鍋`;
                        if (Number(`${bigData[i]['FG%']}`) >= 40) statics += `命中率${bigData[i]['FG%']}%`
                        if (Number(`${bigData[i]['3PM']}`) >= 3) statics += `${bigData[i]['3PM']}三分命中`;
                        resText['contents']['body'].contents[1]['contents'].push(
                            {
                                "type": "box",
                                "layout": "baseline",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": statics,
                                        "wrap": true,
                                        "color": "#223332",
                                        "size": "md"
                                    }
                                ],
                                "margin": "md",
                            }
                        );
                    }
                }
                if (resText['contents']['body'].contents[1]['contents'].length == 0) {
                    resText['contents']['body'].contents[1]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": "無",
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    })
                }
                break
            case '戰報':
                let PTS = bigData.sort((a, b) => b.PTS - a.PTS).slice(0, 5);
                let REB = bigData.sort((a, b) => b.REB - a.REB).slice(0, 5);
                let AST = bigData.sort((a, b) => b.AST - a.AST).slice(0, 5);
                let STL = bigData.sort((a, b) => b.STL - a.STL).slice(0, 5);
                let BLK = bigData.sort((a, b) => b.BLK - a.BLK).slice(0, 5);
                let THREE = bigData.sort((a, b) => b['3PM'] - a['3PM']).slice(0, 5);
                let TO = bigData.sort((a, b) => b.TO - a.TO).slice(0, 5);
                let FT = bigData.sort((a, b) => b.FTA - a.FTA).slice(0, 5);
                let FGA = bigData.sort((a, b) => b.FGA - a.FGA).slice(0, 5);
                resText = {
                    "type": "flex",
                    "altText": `${today}NBA戰報`,
                    "contents": {
                        "type": "bubble",
                        "body": {
                            "type": "box",
                            "layout": "vertical",
                            "contents": [
                            ]
                        }
                    }
                };
                resText['contents']['body'].contents.push(
                    {
                        "type": "text",
                        "text": "得分前五",
                        "weight": "bold",
                        "size": "xl",
                        "margin": "md"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "籃板前五",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "助攻前五",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "抄截前五",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "火鍋前五",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "失誤王",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "三分前五",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "買飯王",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }, {
                    "type": "text",
                    "text": "自幹王",
                    "weight": "bold",
                    "size": "xl",
                    "margin": "md"
                },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "margin": "lg",
                        "contents": []
                    }
                );
                PTS.forEach(p => {
                    resText['contents']['body'].contents[1]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    let statics = `${p.PTS}分 ${p.REB}籃板 ${p.AST}助攻`;
                    if (Number(`${p.STL}`) >= 2) statics += `${p.STL}抄截`;
                    if (Number(`${p.BLK}`) >= 2) statics += `${p.BLK}鍋`;
                    if (Number(`${p['FG%']}`) >= 40) statics += `命中率${p['FG%']}%`
                    if (Number(`${p['3PM']}`) >= 3) statics += `${p['3PM']}三分命中`;
                    resText['contents']['body'].contents[1]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": statics,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                REB.forEach(p => {
                    resText['contents']['body'].contents[3]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[3]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p.REB}籃板`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                AST.forEach(p => {
                    resText['contents']['body'].contents[5]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[5]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p.AST}助攻`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                STL.forEach(p => {
                    resText['contents']['body'].contents[7]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[7]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p.STL}抄截`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                BLK.forEach(p => {
                    resText['contents']['body'].contents[9]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[9]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p.BLK}火鍋`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                TO.forEach(p => {
                    resText['contents']['body'].contents[11]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[11]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p.TO}失誤`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                THREE.forEach(p => {
                    resText['contents']['body'].contents[13]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[13]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p['3PA']}投 ${p['3PM']}中 ${p['3P%']}%三分命中率`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                FT.forEach(p => {
                    resText['contents']['body'].contents[15]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    resText['contents']['body'].contents[15]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": `${p['FTA']}投 ${p['FTM']}中 ${p['FT%']}%罰球命中率`,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                FGA.forEach(p => {
                    resText['contents']['body'].contents[17]['contents'].push({
                        "type": "box",
                        "layout": "baseline",
                        "contents": [
                            {
                                "type": "text",
                                "text": `${p.PLAYER}`,
                                "color": "#238aeb",
                                "size": "lg",
                                "weight": "bold",
                            }
                        ],
                        "margin": "md"
                    });
                    let statics = `${p['FGA']}投 ${p['FGM']}中 ${p['FG%']}%命中率`;
                    resText['contents']['body'].contents[17]['contents'].push(
                        {
                            "type": "box",
                            "layout": "baseline",
                            "contents": [
                                {
                                    "type": "text",
                                    "text": statics,
                                    "wrap": true,
                                    "color": "#223332",
                                    "size": "md"
                                }
                            ],
                            "margin": "md",
                        }
                    );
                });
                break
            default:
                return null;
        }
        let messages = []
        messages.push(resText);
        return client.replyMessage(replyToken, messages);
    } catch (err) {
        console.log(err)
    }

}