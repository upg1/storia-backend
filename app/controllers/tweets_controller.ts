// import type { HttpContext } from '@adonisjs/core/http'
import { OpenAIEmbeddings } from "@langchain/openai";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { VoyageEmbeddings } from "langchain/embeddings/voyage";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ApifyClient } from 'apify-client'

import env from '#start/env'

const APIFY_APP_TOKEN = env.get('APIFY_APP_TOKEN')
const APIFY_DATASET_ID	= env.get('APIFY_DATASET_ID')
const VOYAGE_API_KEY = env.get('VOYAGE_API_KEY')
const AURA_CONNECTION_KEY = env.get('AURA_CONNECTION_KEY')
const AURA_CONNECTION_URI = env.get('AURA_CONNECTION_URI')

const SCHEME_STR = 'neo4j+s://'



const embeddings = new VoyageEmbeddings({
  apiKey: VOYAGE_API_KEY
});

async function fetchTweets() {

	const client = new ApifyClient({
	    token: APIFY_APP_TOKEN
	});

	// Fetches results from the actor's dataset.
	const { items } = await client.dataset(APIFY_DATASET_ID).listItems();



  const tweets = await items.map(item => item.full_text); // Assuming 'page_content' holds the tweet text
  
  return tweets;
}


const processTweets = async (tweets) => {

	// Configuration object for Neo4j connection and other related settings
	const config = {
	  url: SCHEME_STR + AURA_CONNECTION_URI, // URL for the Neo4j instance
	  username: "neo4j", // Username for Neo4j authentication
	  password: AURA_CONNECTION_KEY,// Password for Neo4j authentication
	  nodeLabel: "tweet_chunk", // Label for the nodes in the graph
	};

	const documents = []
	for (const tweet of tweets) {
  		documents.push({page_content: tweet,  metadata: { source: "testtweets" }})
	}

	const neo4jVectorIndex = await Neo4jVectorStore.fromDocuments(
	  documents,
	  embeddings,
	  config
	);


	const retriever = neo4jVectorIndex.asRetriever();

	const prompt = await pull<ChatPromptTemplate>("rlm/rag-prompt");
    const llm = new ChatAnthropic({
				  temperature: 0.9,
				  modelName: "claude-3-sonnet-20240229",
				  // In Node.js defaults to process.env.ANTHROPIC_API_KEY,
				  // anthropicApiKey: "YOUR-API-KEY",
				  maxTokens: 1024,
				});

    const ragChain = await createStuffDocumentsChain({
		  llm,
		  prompt,
		  outputParser: new StringOutputParser(),
		});


    const retrievedDocs = await retriever.getRelevantDocuments(
  		"what is the general topic of these tweets and who are some key people or account handles mentioned in the tweets?"
	);

	const answer = await ragChain.invoke({
	  question: "what is the general topic of these tweets and who are some key people or account handles mentioned in the tweets?",
	  context: retrievedDocs,
	});

	return answer


}

export default class TweetsController {

	async index(ctx: HttpContextContract) {
	// ... your existing index method logic ...
	}

	async analyze({ request, response }: HttpContextContract) {
		// 1. Retrieve tweet data
		// const tweets = request.input('tweets') 
		const tweets =  await fetchTweets()

		console.log(tweets)
		// 2. Perform your tweet analysis (Adapt from your Python code)
		// ... your logic using LangChainJS, Neo4j, etc. ...
		const analysisResult = processTweets(tweets) // Assuming you have this function

		console.log(analysisResult)

		// 3. Return the analysis result
		return response.json(analysisResult) 
	}
}