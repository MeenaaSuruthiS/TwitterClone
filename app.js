const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const dbPath = path.join(__dirname, 'twitterClone.db')
const app = express()

app.use(express.json())

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({filename: dbPath, driver: sqlite3.Database})
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(-1)
  }
}
initializeDBAndServer()
app.get('/', (request, response) => {
  response.send('Welcome to the Twitter Clone API!')
})

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

// REGISTERS API

app.post('/register/', async (request, response) => {
  const {username, name, password, gender} = request.body
  if (password.length < 6) {
    response.status(400)
    response.send('Password is too short')
    return
  }
  const hashedPassword = await bcrypt.hash(request.body.password, 10)
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    const createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        )`
    await db.run(createUserQuery)
    response.status(200)
    response.send('User created successfully')
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//login API

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${username}';`
  const getUserId = await db.get(getUserIdQuery)

  const userTweetFeedQuery = `
        SELECT 
          u.username AS username,
          t.tweet AS tweet,
          t.date_time AS dateTime
        FROM 
          follower f
          JOIN tweet t ON f.following_user_id = t.user_id
          JOIN user u ON t.user_id = u.user_id
        WHERE 
          f.follower_user_id=${getUserId.user_id}
        ORDER BY 
          t.date_time DESC
        LIMIT 4;`

  const getArray = await db.all(userTweetFeedQuery)
  response.send(getArray)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = request

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const user = await db.get(getUserIdQuery)

  const userFollowingQuery = `
      SELECT u.name 
      FROM user u
      INNER JOIN follower f ON u.user_id = f.following_user_id
      WHERE f.follower_user_id = ${user.user_id}
    `

  const data = await db.all(userFollowingQuery)
  response.send(data)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request

  const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
  const user = await db.get(getUserIdQuery, [username])

  const userFollowersQuery = `
      SELECT u.name 
      FROM user u
      INNER JOIN follower f ON u.user_id = f.follower_user_id
      WHERE f.following_user_id = ?
    `

  const data = await db.all(userFollowersQuery, [user.user_id])
  response.send(data)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {username} = request
  const {tweetId} = request.params
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`
  const getUserId = await db.get(getUserIdQuery)
  const getTweetDailyQuery = `SELECT t.tweet as tweet, COUNT(DISTINCT l.like_id) as likes, 
   COUNT(DISTINCT r.reply_id) as replies, t.date_time as dateTime FROM tweet t 
   LEFT JOIN like l ON t.tweet_id  = l.tweet_id 
   LEFT JOIN reply r ON t.tweet_id = r.tweet_id  
   WHERE t.user_id IN (SELECT following_user_id FROM follower 
   WHERE follower_user_id = ${getUserId.user_id}) AND t.tweet_id =${tweetId}
   GROUP BY t.tweet,t.date_time;`
  const tweetDetails = await db.get(getTweetDailyQuery)

  if (tweetDetails !== undefined) {
    response.send(tweetDetails)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`
    const user = await db.get(getUserIdQuery)
   
    const getTweetLikeQuery = `SELECT u.username  FROM like l 
  INNER JOIN user u ON l.user_id=u.user_id
  WHERE l.tweet_id=${tweetId} AND l.tweet_id IN (SELECT t.tweet_id FROM tweet t 
  INNER JOIN follower f ON t.user_id=f.following_user_id
  WHERE f.follower_user_id=${user.user.id})`
    const tweetDetails = await db.all(getTweetLikeQuery)
    const likesList = tweetDetails.map(user => user.name)
    if (tweetDetails !== undefined) {
      response.send({likes: likesList})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}';`
    const user = await db.get(getUserIdQuery)
    
    const getTweetReplyQuery = `SELECT u.name as name, r.reply as reply FROM reply r INNER JOIN user u  
    ON r.user_id = u.user_id WHERE r.tweet_id = ${tweetId} AND  
    r.user_id IN (SELECT following_user_id FROM follower  
    WHERE follower_user_id = ${user.user_id})`
    const tweetDetails = await db.all(getTweetReplyQuery)
    if (tweetDetails !== undefined) {
      response.send({replies: tweetDetails})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserIdQuery = `SELECT * FROM user WHERE username = '${username}'`
  const user = await db.get(getUserIdQuery)
  const tweetQuery = `SELECT t.tweet as tweet,COUNT(l.like_id) as likes,
  COUNT(r.reply_id) as replies, t.date_time as dateTime FROM tweet t 
  LEFT JOIN reply r ON t.tweet_id = r.tweet_id 
  LEFT JOIN like l ON t.tweet_id = l.tweet_id 
  WHERE t.user_id = ${user.user_id}
  GROUP BY t.tweet,t.date_time; `
  const getArray = await db.all(tweetQuery)
  response.send(getArray)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const {tweet} = request.body // Extract tweet properly

  // Get user ID securely using a parameterized query
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`
  const user = await db.get(getUserIdQuery)

  // Insert tweet with user_id
  const tweetUserQuery = `INSERT INTO tweet (tweet, user_id) VALUES ('${tweet}',${user.user_id})`
  await db.run(tweetUserQuery)

  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const {tweetId} = request.params
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
    const user = await db.get(getUserIdQuery, [username])

    const deleteQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId} and user_id = ${user.user_id}`
    const delteQuery = await db.run(deleteQuery)
    if (delteQuery !== undefined) {
      response.send('Tweet Removed')
      return
    } else {
      response.status(401)
      response.send('Invalid Request')
      return
    }
  },
)

module.exports = app
