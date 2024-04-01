/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  AURA_CONNECTION_URI: Env.schema.string(),
  AURA_CONNECTION_KEY: Env.schema.string(),
  ANTHROPIC_API_TOKEN: Env.schema.string(),
  VOYAGE_API_KEY: Env.schema.string(),
  APIFY_APP_TOKEN: Env.schema.string(),
})
