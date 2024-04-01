/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import TweetsController from '#controllers/tweets_controller'

router.get('/', async () => {
  return {
    hello: 'world',
  }
})

router.get('/create-influencer-handles', [TweetsController, 'createInfluencerHandles'])

router.get('/create-random-influencer-follows', [TweetsController, 'generateRandomFollowsForAllHandles'])




