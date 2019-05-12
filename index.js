/*
 *  Server-side RATE.YGSTR.COM
 *  Fortnite skin rating website
 *  Olle Kaiser (Yogsther) 2018
 */

var port = 80

const startTime = Date.now();
var express = require("express");
var socket = require("socket.io");
var crypt = require("bcrypt-nodejs");
const request = require('request');
const download = require('image-downloader')
var http = require('http');
var https = require('https');
var app = express();
/** Import file loader. */
var fs = require("fs");
var path = require('path');
const bad_words = [ /* String array of bad words */ ]

var store = [];

const credentials = {
    key: fs.readFileSync('ssl/key.txt'),
    cert: fs.readFileSync('ssl/cert.txt')
};



var server = app.listen(port, function () {
    console.log("Listening to requests on port " + port);
    // Static files
    //app.use(express.static("public"));
    // Socket setup

    var io = socket(server);
    var validCodes = new Array();
    var skins;
    var users = loadUsers();
    var cachedTotalVotes = 0;
    var token = fs.readFileSync("token.txt", "utf8")

    var badWords = JSON.parse(fs.readFileSync("badwords.txt"));
    var comments = new Array();
    var deletedComments = new Array();

    loadDeletedComments();


    function loadDeletedComments() {
        var commentDir = fs.readdirSync("deletedComments");
        commentDir.forEach(comment => {
            deletedComments.push(JSON.parse(fs.readFileSync("deletedComments/" + comment, "utf8")))
        })

        deletedComments.sort(dateSort);

        function dateSort(a, b) {
            if (a.date < b.date)
                return -1;
            if (a.date > b.date)
                return 1;
            return 0;
        }
        console.log("Loaded deleted comments.");
        loadComments();
    }

    setTimeout(() => {
        hourReport();
    }, 10000)

    setInterval(() => {
        hourReport();
    }, 1000 * 60 * 60)

    setInterval(() => {
        loadRecords();
    }, 1000 * 60 * 60 * 24 /* Update records each day.*/ )


    var doUpdateStore = false;

    var storeSimple = new Array();


    function updateStore() {
        try {
            request({
                url: "https://fortnite-public-api.theapinetwork.com/prod09/store/get",
                method: "POST",
                json: true,
                headers: {
                    "content-type": "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW",
                    "Authorization": "******"
                }
            }, function (error, response, body) {
                console.log("Updated store. " + new Date())

                var storeSimplePrivate = new Array();
                try {
                    response.body.items.forEach(item => {
                        storeSimple.push(item.name.toLowerCase());
                    })

                    if (store == response.body.items || storeSimplePrivate == storeSimple) {
                        console.log("Recived old store, scheduled new update in 2 seconds.")
                        setTimeout(() => {
                            updateStore();
                        }, 2000);
                        return;
                    }

                    store = response.body.items;

                    storeSimple = storeSimplePrivate;

                    skins.forEach(skin => {
                        skin.inStore = false;
                        store.forEach(item => {
                            if (item.name.toLowerCase() == skin.name.toLowerCase() &&
                                item.item.type.toLowerCase() == skin.type.toLowerCase()) {
                                // Item is in the store
                                skin.inStore = true;
                                console.log("In store: " + skin.name);
                            }
                        })
                    })
                } catch (e) {
                    console.log("Failed store.")
                }

            });
        } catch (e) {
            console.log("Failed to update store.");
        }
    }



    setInterval(() => {
        // Check to update store.
        var hours = new Date().getHours()
        if (hours == 2 && doUpdateStore) {
            setTimeout(() => {
                updateStore(); // Update stats
            }, 5000);
            doUpdateStore = false;
        }
        if (hours != 2 && !doUpdateStore) {
            doUpdateStore = true; // Schedule an update
        }
    }, 1000 /* Check every second*/ )


    function containesBadWord(comment) {
        for (badWord of bad_words) {
            if (comment.toLowerCase().indexOf(badWord) != -1) return true;
        }
        return false;
    }

    function loadComments() {
        var commentDir = fs.readdirSync("comments");
        var count = 1;
        commentDir.forEach(comment => {
            comments.push(JSON.parse(fs.readFileSync("comments/" + comment, "utf8")))
        })

        comments.sort(dateSort);

        function dateSort(a, b) {
            if (a.date < b.date)
                return -1;
            if (a.date > b.date)
                return 1;
            return 0;
        }
        loadSkins();
    }


    var check = setInterval(() => {
        console.log("Checking skin status...");
        if (skins != undefined && users !== undefined) {
            clearInterval(check);
            console.log("Clear for counting votes.")
            updateGlobalScores();
            return;
        }
    }, 250);

    var update = setInterval(() => {
        users = loadUsers();
        updateGlobalScores()
    }, 10000 /* Update global score every ten seconds */ )

    function loadSkins() {
        skins = JSON.parse(fs.readFileSync("skins.txt", "utf8"));

        // Inject default skins
        for (let i = 0; i < 8; i++) {
            skins.push({
                name: "Recruit " + (i + 1),
                code: "RECRUIT_" + (i + 1),
                price: "Default",
                type: "outfit",
                src: "img/" + "RECRUIT_" + (i + 1) + ".png",
                rarity: "common"
            })
        }
        var insertedComments = [];
        for (let i = 0; i < skins.length; i++) {
            //skins[i].code = skins[i].type+"_"+skins[i].name.split(" ").join("_").toUpperCase().split("#").join("_").split("/").join("_");
            skins[i].history = new Array();
            skins[i].comments = new Array();
            delete skins[i].source; // Remove the source, unnecessary data.
            comments.forEach(comment => {
                if (comment.upvotes == undefined) comment.upvotes = new Array();
                if (comment.downvotes == undefined) comment.downvotes = new Array();
                if (comment.skin.indexOf("_TYPE_") != -1) {
                    comment.type = comment.skin.substr(0, comment.skin.indexOf("_TYPE_"));
                }
                if (comment.skin.indexOf(skins[i].code) != -1 && insertedComments.indexOf(comment.id) == -1) {
                    if (comment.type === undefined || comment.type == skins[i].type) {
                        skins[i].comments.push({
                            id: comment.id,
                            message: comment.message,
                            username: comment.username,
                            mod: comment.mod,
                            date: comment.date,
                            upvotes: comment.upvotes.length,
                            downvotes: comment.downvotes.length
                        })

                        insertedComments.push(comment.id)
                    }
                }
            })
            //if(skins[i].code.toLowerCase().indexOf("GOLF") != -1) console.log(skins[i].code);
            validCodes.push(skins[i].code);
            var dup = false;
            for (let j = 0; j < skins.length; j++) {
                if (skins[j].name == skins[i].name && j != i && skins[j].type == skins[i].type) {
                    dup = j;
                    break;
                }
            }
            if (dup !== false) {
                console.log("Deteled duplicate: " + skins[dup].name);
                skins.splice(dup, 1); // Delte
            }
        }

        /* Sort after rarity */
        var rarities = ["common", "uncommon", "rare", "epic", "legendary"];

        function raritySort(a, b) {
            if (rarities.indexOf(a.rarity) > rarities.indexOf(b.rarity))
                return -1;
            if (rarities.indexOf(a.rarity) < rarities.indexOf(b.rarity))
                return 1;
            return 0;
        }

        function ratingSort(a, b) {
            if (a.rating < b.rating)
                return -1;
            if (a.rating > b.rating)
                return 1;
            return 0;
        }

        //skins.sort(raritySort);
        skins.sort(ratingSort);
        console.log("Loaded skins!");


        loadRecords();
    }

    function loadUsers() {
        var u = fs.readdirSync("users");
        return u;
    }

    function ipToString(ip) {
        while (ip.indexOf(".") != -1) ip = ip.replace(".", "_");
        while (ip.indexOf(":") != -1) ip = ip.replace(":", "_");
        while (ip.indexOf("f") != -1) ip = ip.replace("f", "");
        return ip;
    }

    function getUser(ip) {
        //if (ip.length > 100) return;
        /* Convert IP to string, that can be saved as file in Windows */
        while (ip.indexOf(".") != -1) ip = ip.replace(".", "_");
        while (ip.indexOf(":") != -1) ip = ip.replace(":", "_");
        while (ip.indexOf("f") != -1) ip = ip.replace("f", "");
        /* ip = ip.split("");

        ip = ip.join(""); */
        if (users.indexOf(ip + ".liv") != -1) {
            /* Old user */
            var account = loadUser(ip);
            return account;
        } else {
            /* New user */
            saveUser(ip, new Object());
            return {
                account: {},
                id: ip
            };
        }
    }

    function loadUser(id) {
        try {
            var acc = JSON.parse(fs.readFileSync("users/" + id + ".liv", "utf8"));
            return {
                account: acc,
                id: id
            };
        } catch (e) {
            console.log("ERR: Corrupt account: " + id);
            return;
        }
    }

    function saveUser(id, content) {
        try {
            fs.writeFileSync("users/" + id + ".liv", JSON.stringify(content));
            var userIndex = cachedIPs.indexOf(id);
            //console.log("User index: " + userIndex + " , checking for: " + id);
            /* Update cached user aswell. */
            if (userIndex == -1) {
                //console.log("WARN: User not cached, saved new user in cache")
                cachedIPs.push(id);
                cachedUsers.push(content);
            } else {
                //console.log("NOTE: Cached user updated")
                cachedUsers[userIndex] = content;
            }

        } catch (e) {
            console.log("ERR: Couldn't write id/ip: " + id);
        }
    }


    var cachedUsers = new Array();
    var cachedIPs = new Array();

    function recordRating(skinName, account, rating) {
        var newVersionName = false;
        if (validCodes.indexOf(skinName) == -1 && validCodes.indexOf(skinName.substr(skinName.indexOf("_TYPE_") + 6)) == -1) {
            console.log("ABUSE: Someone tried to rate an invalid skin!");
            /* return; */
        } else if (rating > 5 || rating < 1) {
            console.log("ABUSE: Someone tried to rate an invalid rating!");
            return;
        } else {
            account.account[skinName] = Math.round(rating);
            saveUser(account.id, account.account);
        }
    }

    var allUsersCached = false;

    function updateGlobalScores() {
        //users = loadUsers();
        for (let i = 0; i < skins.length; i++) {
            skins[i].votes = 0;
            skins[i].stars = [0, 0, 0, 0, 0];
            //skins[i].votesArr = new Array();
            skins[i].rating = 0;
        }
        for (let i = 0; i < users.length; i++) {
            if (i % 1000 == 0 && !allUsersCached) {
                /* Log status */
                console.log("Reading users: " + i.toLocaleString() + "/" + users.length.toLocaleString());
            }
            var user;
            var cacheIndex = -1;
            // CHANGE: All users should be cached always.
            /* if(allUsersCached){
                cacheIndex = cachedIPs.indexOf(users[i].substr(0, users[i].indexOf(".")))
            } */

            if (allUsersCached) {
                user = cachedUsers[i];
            } else if (cacheIndex != -1) {
                // Read from cached list
                user = cachedUsers[cacheIndex];
            } else {
                // Read from storage
                user = JSON.parse(fs.readFileSync("users/" + users[i]));
                cachedIPs.push(users[i].substr(0, users[i].indexOf(".")));
                cachedUsers.push(user);
            }

            try {
                Object.keys(user).forEach(function (key) {
                    //skins[getSkinIndexFromCode(key)].votesArr.push(user[key]);
                    skins[getSkinIndexFromCode(key)].stars[user[key] - 1]++;

                });
            } catch (e) {}
        }



        if (!allUsersCached) {
            var time = (Math.round((Date.now() - startTime) / 100 / 60) / 10) + " minutes.";

            console.log("Loaded users, everything ready. Loading took " + time);

            updateStore();
        }
        allUsersCached = true;

        var totalVotesCount = 0;
        for (let i = 0; i < skins.length; i++) {
            if (skins[i].stars.reduce(add, 0) >= 1) {
                skins[i].rating = 0;
                totalVotesCount += skins[i].stars.reduce(add, 0);
                //totalVotesCount += skins[i].votesArr.length;
                var totalVotes = skins[i].stars.reduce(add, 0);
                //var totalVotes = skins[i].votesArr.length;
                var voteSum = 0;
                //skins[i].votesArr.forEach(vote => voteSum += vote);
                for (let j = 0; j < skins[i].stars.length; j++) {
                    voteSum += skins[i].stars[j] * (j + 1);
                }
                skins[i].exactRating = voteSum / totalVotes
                skins[i].rating = Math.round((skins[i].exactRating) * 100) / 100;;
                skins[i].votes = totalVotes;
            }
        }

        for (let i = 0; i < skins.length; i++) {
            var higherRatedSkins = 0;
            var higherRatedSameCategory = 0;
            for (skin of skins) {
                if (skin.rating > skins[i].rating) {
                    higherRatedSkins++;
                    if (skin.type == skins[i].type) {
                        higherRatedSameCategory++;
                    }
                } else {
                    //break;
                }
            }
            skins[i].stats = {
                higherRatedSameCategory: higherRatedSameCategory,
                higherRatedSkins: higherRatedSkins
            }
        }

        //console.log("Updated scores. New votes: " + newVotes + ". v/s: " + (newVotes / 10) + ". Total votes: " + cachedTotalVotes);
    }




    function loadRecords() {
        console.log("Loading records...")
        skins.forEach(skin => skin.history = []); // Reset history
        var totalPushedObjects = 0;
        var recordsDir = fs.readdirSync("records");
        var sampleSize = 50;
        var hopSize = Math.round(recordsDir.length / sampleSize);
        for (let i = 0; i < recordsDir.length; i += hopSize) {
            var fileName = recordsDir[i];

            var recordDate = Number(fileName.substr(fileName.indexOf("_") + 1, fileName.length - 11));

            var record = fs.readFileSync("records/" + fileName, "utf8");
            record = JSON.parse(record);

            skins.forEach(skin => {
                if (record[skin.type.toLowerCase() + "_TYPE_" + skin.code.toUpperCase()] !== undefined) {
                    totalPushedObjects++;
                    skin.history.push({
                        rating: record[skin.type.toLowerCase() + "_TYPE_" + skin.code.toUpperCase()],
                        date: Math.round(recordDate / 1000 / 60)
                    })
                } else {
                    //console.log("Missing skin from record: " + skin.type.toLowerCase() + "_TYPE_" + skin.code.toUpperCase())
                }
            })
        }

        console.log("Loaded record history. Total pushed objects: " + totalPushedObjects);
    }


    function hourReport() {

        var totalVotesCount = 0;

        // Count votes
        for (let i = 0; i < skins.length; i++) {
            if (skins[i].stars.reduce(add, 0) >= 1) {
                skins[i].rating = 0;
                totalVotesCount += skins[i].stars.reduce(add, 0);
                //totalVotesCount += skins[i].votesArr.length;
                var totalVotes = skins[i].stars.reduce(add, 0);
                //var totalVotes = skins[i].votesArr.length;
                var voteSum = 0;
                //skins[i].votesArr.forEach(vote => voteSum += vote);
                for (let j = 0; j < skins[i].stars.length; j++) {
                    voteSum += skins[i].stars[j] * (j + 1);
                }
                var rating = Math.round((voteSum / totalVotes) * 100) / 100;
                skins[i].rating = rating;
                skins[i].votes = totalVotes;
            }
        }


        var newVotes = totalVotesCount - cachedTotalVotes;
        cachedTotalVotes = totalVotesCount
        console.log("------ Report ------\nHour report: " + new Date() + "\n" +
            "New votes: " + newVotes +
            "\nTotal votes: " + cachedTotalVotes + "\n--------------------"
        );

        if (Date.now() - startTime > 1800000 /* 30 minutes */ ) {
            /* Record ratings */
            var hourRecord = new Object();
            skins.forEach(skin => {
                hourRecord[skin.type + "_TYPE_" + skin.code] = skin.rating;
            })
            fs.writeFileSync("records/" + "record_" + Date.now() + ".liv", JSON.stringify(hourRecord))
        }
    }

    function add(a, b) {
        return a + b;
    }

    function getSkinIndexFromCode(code) {

        var types = ["wrap", "bundle", "back_bling", "pet", "toy", "music", "emoji", "emote", "glider", "loading_screen", "outfit", "pickaxe", "skydiving_trail", "spray", "umbrella"];
        var updatedCode = false;
        types.forEach(type => {
            if (code.indexOf(type) != -1) {
                updatedCode = true;
            }
        })
        var type = undefined;
        if (updatedCode) {
            type = code.substr(0, code.indexOf("_TYPE_"));
            code = code.substr(code.indexOf("_TYPE_") + 6);
        }

        for (let i = 0; i < skins.length; i++) {
            if (skins[i].code == code) {
                if ((type !== undefined && skins[i].type == type) || type == undefined) {
                    return i;
                }
            }
        }
        return false;
    }

    function emitUserAccount(socket) {
        var acc = getUser(getIP(socket));
        var ip = getIP(socket);
        acc.upvotes = new Array();
        acc.downvotes = new Array();
        acc.karma = 0;
        acc.comments = new Array();
        comments.forEach(comment => {
            if (comment.ip == ip) {
                // Comment by user, save karma
                acc.karma += comment.upvotes.length;
                acc.karma -= comment.downvotes.length;
                acc.comments.push({
                    upvotes: comment.upvotes.length,
                    downvotes: comment.downvotes.length,
                    karma: comment.upvotes.length - comment.downvotes.length,
                    username: comment.username,
                    date: comment.date,
                    mod: comment.mod,
                    message: comment.message
                })
            }
            if (comment.upvotes.indexOf(ip) !== -1) {
                acc.upvotes.push(comment.id);
            } else if (comment.downvotes.indexOf(ip) !== -1) {
                acc.downvotes.push(comment.id);
            }
        })
        acc.id = "?";
        socket.emit("account", acc);
    }

    function getIP(socket) {
        return socket.request.connection.remoteAddress;
    }

    io.on("connection", function (socket) {

        var ip = getIP(socket);
        /* Send out data to user */
        socket.emit("skins", skins);
        emitUserAccount(socket);

        socket.on("update", () => {
            updateStore();
        })

        socket.on("get", () => {
            emitUserAccount(socket)
            socket.emit("skins", skins);
        })

        socket.on("rate", pack => {
            //console.log("Rating: " + pack.skin + " : " + pack.rating);
            var user = getUser(ip);
            //console.log("Rating: " + ip + " " + pack.skin + " > " + pack.rating);
            if (pack.rating > 100 || pack.rating < 0) return;
            recordRating(pack.skin, user, pack.rating)
            socket.emit("confirmedVote", {
                skin: pack.skin,
                rating: pack.rating
            });
        });

        socket.on("commentVote", package => {

            var comment;
            var ip = getIP(socket);
            var id = package.id;
            comments.forEach(com => {
                if (com.id == id) {
                    comment = com;
                }
            })

            if (comment.ip == ip) {
                socket.emit("err", "You can't vote on your own comment.")
                return;
            }

            /* Check what the current action for this user is. */
            var currentAction = "novote";
            if (comment.downvotes !== undefined) {
                if (comment.downvotes.indexOf(ip) !== -1) {
                    currentAction = "downvote";
                }
            } else {
                comment.downvotes = new Array();
            }
            if (comment.upvotes !== undefined) {
                if (comment.upvotes.indexOf(ip) !== -1) {
                    currentAction = "upvote";
                }
            } else {
                comment.upvotes = new Array();
            }

            /* Complete action */
            if (currentAction == package.type) {
                return;
            }
            if (package.type == "upvote") {
                comment.upvotes.push(ip);
                /* Even if it's not there, it will try to splice -1 and nothing will happen. */
                comment.downvotes.splice(comment.downvotes.indexOf(ip), 1);
            } else if (package.type == "downvote") {
                comment.downvotes.push(ip);
                comment.upvotes.splice(comment.upvotes.indexOf(ip), 1);
            } else {
                comment.upvotes.splice(comment.upvotes.indexOf(ip), 1);
                comment.downvotes.splice(comment.downvotes.indexOf(ip), 1);
            }

            // Update live comment
            /* console.log("Checking comments with skincode: " + comment.skin + " id: " + comment.id);
            for(skin of skins){
                if (skin.code == comment.skin) {
                    
                }
            } */

            var skin = skins[getSkinIndexFromCode(comment.skin)];
            try {
                for (com of skin.comments) {
                    if (com.id == comment.id) {
                        //console.log("Found comment, updated!")
                        com.upvotes = comment.upvotes.length;
                        com.downvotes = comment.downvotes.length;
                    }
                }
            } catch (e) {
                console.log("WARN: Couldn't update live comments!")
            }

            //console.log("Comment vote " + package.type + " > " + comment.skin + " : " + comment.message)
            // Write updated comment.
            fs.writeFileSync("comments/comment_" + id + ".txt", JSON.stringify(comment));
        })

        socket.on("comment", package => {
            var err = null;
            var ip = getIP(socket);

            if (package == undefined) return;
            if (package.username == undefined) return;
            if (package.message == undefined) return;
            if (package.username.trim().length == 0) return;
            //if (containesBadWord(package.message)) err = "Your comment contains vulgar language, please rephrase the comment. Thanks!";
            //if (containesBadWord(package.username)) err = "Your username contains vulgar language, please rephrase your username. Thanks!";
            var mod = package.token === token;
            badWords.forEach(badWord => {
                if (package.message.toLowerCase().indexOf(badWord) != -1) err = "Message contains bad word: " + badWord;
                if (package.username.toLowerCase().indexOf(badWord) != -1) err = "Username contains bad word: " + badWord;
            })
            if (package.message.length > 200) err = "Comment is too long, cannot exceed 200 characters."
            if (package.username.length > 12) err = "Username is too long, cannot exceed 12 characters."
            if (package.message.length < 1) err = "No message provided";
            if (package.username.length < 3) err = "Username must be at least 3 characters long.";

            var userCommentCount = 0;
            var userSkinsComments = new Object();
            comments.forEach(comment => {
                if (comment.ip == ip) {
                    userCommentCount++;
                    if (Date.now() < comment.date + (1000 * 60 * 60 * 24) && !mod) {
                        if (isNaN(userSkinsComments[comment.skin])) userSkinsComments[comment.skin] = 1;
                        else userSkinsComments[comment.skin]++;

                        if (userSkinsComments[comment.skin] > 0 && comment.skin == package.skin) {
                            err = "You can only comment on each skin once a day. Come back in 24 hours to comment again on this skin."
                        }
                    }
                }
            })

            if (isBanned(ip) !== false) {
                err = "This account is suspended and cannot comment anymore. Reason: " + isBanned(ip) + " -  If you have questions, contact me on reddit u/Yogsther"
            }

            if (getSkinIndexFromCode(package.skin) === false) {
                err = "Invalid skin to comment on, please inspect a skin and comment on it.";
            }

            if (err !== null) {
                socket.emit("err", err);
                return;
            }

            var comment = {
                message: package.message,
                username: package.username,
                mod: package.token === token,
                downvotes: new Array(),
                upvotes: new Array(),
                ip: ip,
                date: Date.now(),
                skin: package.skin,
                id: comments.length + "_" + Date.now() + "_" + "2"
            }

            fs.writeFileSync("comments/comment_" + comment.id + ".txt", JSON.stringify(comment));
            comments.push(comment)
            skins[getSkinIndexFromCode(comment.skin)].comments.push({
                message: comment.message,
                username: comment.username,
                mod: comment.mod,
                date: comment.date,
                downvotes: new Array(),
                upvotes: new Array(),
                id: comment.id
            })
            console.log("New comment: " + comment.skin + " > " + comment.username + ": " + comment.message);
        })

        var suspendedList = JSON.parse(fs.readFileSync("suspendedUsers.txt"));

        function isBanned(ip) {
            var banned = false;
            suspendedList.forEach(suspension => {
                if (ip == suspension.ip) banned = suspension.reason;
            })
            return banned;
        }


        socket.on("ban", package => {
            if (package.token === token) {
                var index = getCommentIndexFromID(package.id);
                var comment = comments[index];
                var ip = comment.ip;
                ban(ip, comment.username, package.reason);
            }
        })

        socket.on("remove", package => {
            if (package.token === token) {
                deleteComment(package.id);
            }
        })

        function deleteComment(id) {
            fs.writeFileSync("deletedComments/comment_" + id + ".txt", JSON.stringify(comments[getCommentIndexFromID(id)]));
            fs.unlink("comments/comment_" + id + ".txt");
            var index = getCommentIndexFromID(id);
            var comment = comments[index]
            deletedComments.push(comment);
            skins[getSkinIndexFromCode(comment.skin)].comments.splice(skins[getSkinIndexFromCode(comment.skin)].comments.indexOf(comment), 1);
            comments.splice(index, 1);
            console.log("Deleted comment: " + id);
        }

        /* function restoreComment(id) {
            writeFileSync("comments/comment_" + id + ".txt", )
        } */

        function getCommentIndexFromID(id) {
            var index = -1;
            comments.forEach((comment, i) => {
                if (comment.id == id) index = i;
            })
            return index;
        }



        function ban(ip, username, reason) {

            var commentRecord = new Array();
            comments.forEach(comment => {
                if (comment.ip == ip) {
                    commentRecord.push(comment);
                    deleteComment(comment.id);
                }
            })

            suspendedList.push({
                ip: ip,
                username: username,
                reason: reason,
                record: commentRecord
            });

            fs.writeFileSync("suspendedUsers.txt", JSON.stringify(suspendedList))
            console.log("Banned user > " + username + " : " + reason);
        }

        socket.on("pardon", package => {
            if (package.token === token) {
                pardon(package.ip);
            }
        })

        function pardon(ip) {
            return; //TODO:::
            suspendedList.forEach((suspension, index) => {
                if (suspension.ip == ip) {
                    console.log("Pardon: " + suspension.username)
                    suspendedList.splice(index, 1);
                    fs.writeFileSync("suspendedUsers.txt", JSON.stringify(suspendedList))
                    deletedComments.forEach(comment => {
                        if (comment.ip == ip) {
                            restoreComment(comment);
                        }
                    })
                }
            })
        }

        function restoreComment(comment) {
            // Move file on diks.
            fs.writeFileSync("comments/comment_" + comment.id + ".txt", JSON.stringify(comment));
            fs.unlink("deletedComments/comment_" + id + ".txt");
            deletedComments.forEach((deletedComment, i) => {
                // Remove comment from deleted comments running cache
                if (deletedComment.id == comment.id) deletedComments.splice(i, 1);
            })
            // Push to cached comments
            comments.push(comment)
            // Push to cached skins
            skins[getSkinIndexFromCode(comment.skin)].comments.push({
                message: comment.message,
                username: comment.username,
                mod: comment.mod,
                date: comment.date,
                downvotes: new Array(),
                upvotes: new Array(),
                id: comment.id
            })
            console.log("Restored comment: " + comment.skin + " > " + comment.username + ": " + comment.message);
        }

        /*  socket.on("commentStream", () => {
                 var commentStream = new Array();
                 comments.forEach(comment => {
                     commentStream.push({
                         username: comment.username,
                         message: comment.message,
                         id: comment.id,
                         skin: comment.skin,
                         mod: comment.mod,
                         date: comment.date,
                         upvotes: comment.upvotes.length,
                         downvotes: comment.downvotes.length,
                         karma: (comment.upvotes.length + 1) - comment.downvotes.length
                     })
                 })

                 socket.emit("commentStream", commentStream);
                 socket.emit("skins", skins);
                 emitUserAccount(socket);
         }) */

        socket.on("adminComments", recivedToken => {
            if (recivedToken === token) {
                var adminComments = new Array();
                comments.forEach(comment => {
                    adminComments.push({
                        username: comment.username,
                        message: comment.message,
                        id: comment.id,
                        skin: comment.skin,
                        mod: comment.mod,
                        date: comment.date
                    })
                })

                var deletedCommentsEmit = new Array();
                deletedComments.forEach(comment => {
                    deletedCommentsEmit.push({
                        username: comment.username,
                        message: comment.message,
                        id: comment.id,
                        skin: comment.skin,
                        date: comment.date
                    })
                })

                socket.emit("adminComments", adminComments);
                socket.emit("suspendedList", suspendedList);
                socket.emit("deletedComments", deletedCommentsEmit);
            }
        })


        // Store lockers
        socket.on("lockerPush", locker => {
            fs.writeFileSync("lockers/locker_" + String(ipToString(getIP(socket))) + ".liv", JSON.stringify(locker));
        })

        socket.on("suggestion", data => {
            if (data.name == undefined || data.name == null) data.name = "NO_NAME";
            try {
                fs.writeFileSync("suggestions/suggestion_" + String(ipToString(getIP(socket))) + "_" + data.name + ".liv", data.name + " \n\n" + data.text);
            } catch (e) {
                console.log("WHOAAA, suggestion almost crashed it", data);
            }

        })

        /* END OF SOCKET */
    });
});