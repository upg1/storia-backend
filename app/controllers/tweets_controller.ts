// import type { HttpContext } from '@adonisjs/core/http'
import { pull } from "langchain/hub";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { VoyageEmbeddings } from "langchain/embeddings/voyage";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
import { ApifyClient } from 'apify-client'
import graphlib, {Graph} from "@dagrejs/graphlib";
import neo4j from "neo4j-driver"
import env from '#start/env'







const APIFY_APP_TOKEN = env.get('APIFY_APP_TOKEN')
const APIFY_DATASET_ID	= env.get('APIFY_DATASET_ID')
const VOYAGE_API_KEY = env.get('VOYAGE_API_KEY')
const AURA_CONNECTION_KEY = env.get('AURA_CONNECTION_KEY')
const AURA_CONNECTION_URI = env.get('AURA_CONNECTION_URI')
const ANTHROPIC_API_TOKEN = env.get('ANTHROPIC_API_TOKEN')

const SCHEME_STR = 'neo4j+s://'

let followerGraph = new Graph();

const driver = neo4j.driver(
  SCHEME_STR + AURA_CONNECTION_URI, // Replace with your database URI
  neo4j.auth.basic('neo4j', AURA_CONNECTION_KEY) // Replace with your credentials
);




async function fetchTopSciencePosts() {
    const client = new ApifyClient({
        token: APIFY_APP_TOKEN
    });

    const topScienceResultsInputApify = {
    	"searchTerms": ["#medtwitter"],
        "addUserInfo": true,
        "maxRequestRetries": 6,
        "maxTweets": 5,
        "scrapeTweetReplies": true,
        "searchMode": "top"
    };

    const topScienceRun = await client.actor("microworlds/twitter-scraper").call(topScienceResultsInputApify);

    const { items } = await client.dataset(topScienceRun.defaultDatasetId).listItems();

    // Return only top 5 science posts
    return items.slice(0,5);
}

function extractUserIdsFromPosts(posts) {
	const userIds = []
	for (const post of posts) {
		userIds.push("@" + post["user"]["screen_name"])
	}
	return userIds
}

function extractUserIdFromPost(post) {
	return "@" + post["user"]["screen_name"]
}

async function fetchFollowersTopPosts(userIds) {
    const client = new ApifyClient({
        token: APIFY_APP_TOKEN
    });

    const topPostsPerUser = [];
    

    for (const userId of userIds) {
    		const userPostsInputApify = {
				    "addUserInfo": true,
				    "handle": [
				        userId
				    ],
				    "maxRequestRetries": 6,
				    "maxTweets": 5,
				    "scrapeTweetReplies": true,
						"searchMode": "top"
				}

        const userPostsRun = await client.actor("microworlds/twitter-scraper").call(userPostsInputApify);

        const { items } = await client.dataset(userPostsRun.defaultDatasetId).listItems();
        const userTopPosts = items.map(item => {
        	return {"user": {"screen_name": item.user.screen_name}, "full_text": item.full_text}
      });
        console.log(userTopPosts.length)
        // Only get top 5 posts from user's profile to later get users.
        topPostsPerUser.push({
            userId: userId,
            topPosts: userTopPosts.slice(0,5)
        });
    }

    return topPostsPerUser;
}

async function isTopPostScienceOrAcademic(postText) {
    // Placeholder implementation: Check if the post contains specific keywords related to science or academic topics
    const scienceKeywords = ["science", "scientific", "research", "study"];
    const academicKeywords = ["academic", "paper", "study", "research"];

    const containsScienceKeyword = scienceKeywords.some(keyword => postText.toLowerCase().includes(keyword));
    const containsAcademicKeyword = academicKeywords.some(keyword => postText.toLowerCase().includes(keyword));

    return containsScienceKeyword || containsAcademicKeyword;
}

async function fetchFollowerGraph() {
    // Initialize new NetworkX graph if one does not already exist.
    if (followerGraph.nodeCount() === 0) {
        followerGraph = new Graph();
    }


    // Step 1: Fetch top tweets related to science
    const topSciencePosts = await fetchTopSciencePosts();

    // Step 2: Extract userIds of users who interacted with the top tweets
    const userIds = extractUserIdsFromPosts(topSciencePosts); // Implement extractUserIdsFromTweets function
    console.log("Step 2 USER ID LENGTH: ", userIds.length)

    // Step 3: Create hypothetical following relationships
    const followingRelationships = createFollowingRelationships(userIds);

    // Step 4: Add nodes and edges to the followerGraph
    for (const userId of userIds) {
        followerGraph.setNode(userId);
        const following = followingRelationships[userId] || [];
        for (const followedUserId of following) {
            followerGraph.setEdge(userId, followedUserId);
        }
    }

    const followerGraphLibJSON = graphlib.json.write(followerGraph)

    console.log(followerGraphLibJSON)

    return followerGraph

}

// Function to create hypothetical following relationships
function createFollowingRelationships(userIds) {
    const followingRelationships = {};
    for (let i = 0; i < userIds.length; i++) {
        const user = userIds[i];
        const followedUserIndex = (i + 4) % userIds.length; // Following a user four positions away
        const followedUser = userIds[followedUserIndex];
        if (!followingRelationships[user]) {
            followingRelationships[user] = [];
        }
        followingRelationships[user].push(followedUser);
    }
    return followingRelationships;
}



async function fetchTweets() {
	const client = new ApifyClient({
	    token: APIFY_APP_TOKEN
	});

	const topScienceResultsInputApify = {
    "addUserInfo": true,
    "maxRequestRetries": 6,
    "maxTweets": 5,
    "scrapeTweetReplies": true,
    "urls": [
        "https://twitter.com/search?q=science&src=typed_query&f=top"
    ]
	}

	const topScienceRun= await client.actor("microworlds/twitter-scraper").call(topScienceResultsInputApify)

	// Fetches results from the actor's dataset.
	const { items } = await client.dataset(topScienceRun.defaultDatasetId).listItems();
		items.forEach((item) => {
		    console.dir(item);
		});

  const tweets = items.map(item => item.full_text); // Assuming 'page_content' holds the tweet text
  
  return tweets;
}


const processTweets = async (tweets) => {
	try {
		// Configuration object for Neo4j connection and other related settings
		const config = {
			url: SCHEME_STR + AURA_CONNECTION_URI, // URL for the Neo4j instance
			username: "neo4j", // Username for Neo4j authentication
			password: AURA_CONNECTION_KEY,// Password for Neo4j authentication
			nodeLabel: "tweet_chunk", // Label for the nodes in the graph
		};


		const documents = []
		for (const tweet of tweets) {
			documents.push({pageContent: tweet, metadata: {source: "testtweets"}})
		}


		const neo4jVectorIndex = await Neo4jVectorStore.fromDocuments(
			documents,
			new VoyageEmbeddings({
      	apiKey: VOYAGE_API_KEY
			}),
			config
		);

		const retriever = neo4jVectorIndex.asRetriever();

		const prompt = await pull<ChatPromptTemplate>("rlm/rag-prompt");
		const llm = new ChatAnthropic({
			temperature: 0.9,
			modelName: "claude-3-sonnet-20240229",
			// In Node.js defaults to process.env.ANTHROPIC_API_KEY,
			anthropicApiKey: ANTHROPIC_API_TOKEN
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

		await neo4jVectorIndex.close()

		return answer
	} catch (error) {
		console.error("An error occurred while processing tweets:", error);
		throw error; // Re-throw the error for handling upstream if needed
	}
}


export default class TweetsController {

	async index(ctx: HttpContextContract) {
	// ... your existing index method logic ...
	}

	async analyze({ request, response }: HttpContextContract) {
		// 1. Retrieve tweet data
		// const tweets = request.input('tweets') 
		const followerGraphLibObj =  await fetchFollowerGraph()

		const followerGraphLibJSON = graphlib.json.write(followerGraphLibObj)

		const createNodeQueries = followerGraphLibJSON.nodes.map(node => (
   		`MERGE (n:${node.label} {id: ${node.id}, properties: $props})`
		));

		// Create relationship queries
		const createRelationshipQueries = followerGraphLibJSON.edges.map(edge => (
			`MATCH (a:{edge.sourceLabel}), (b:{edge.targetLabel})
			 WHERE a.id = ${edge.source} AND b.id = ${edge.target} 
			 CREATE (a)-[r:${edge.type} {properties: $props}]->(b)`
		));
	  // const session = driver.session();

		// try {
		//   // Create nodes
		//   for (const query of createNodeQueries) {
		//     await session.run(query, { props: node.properties }); 
		//   }

		//   // Create relationships
		//   for (const query of createRelationshipQueries) {
		//     await session.run(query, { props: edge.properties }); 
		//   }

		// } finally {
		//   await session.close();
		//   await driver.close();
		// }

		// 2. Perform your tweet analysis (Adapt from your Python code)
		// ... your logic using LangChainJS, Neo4j, etc. ...
		// const analysisResult = await processTweets(tweets) // Assuming you have this function


		// 3. Return the analysis result
		return response.json("Completed run") 
	}
}