const express = require('express');
const handlebars = require('express-handlebars');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const axios = require('axios').default;
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.engine('handlebars', handlebars({
    defaultLayout: 'main',
    helpers: require('./config/handlebars-helpers')
}));
app.set('view engine', 'handlebars');
app.use(express.static('public'))


app.get("/", (req, res) => {
    const options = {
        method: 'GET',
        url: 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/liveData/scoreboard/todaysScoreboard_00.json',
      };
    axios.request(options).then(function (response) {
        const games = response.data.scoreboard.games;
            
        res.render("home", {games: games});
    }).catch(function (error) {
        console.error(error);
    });
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