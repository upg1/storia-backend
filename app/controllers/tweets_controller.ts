// import type { HttpContext } from '@adonisjs/core/http'
import { pull } from "langchain/hub";
import { Neo4jVectorStore } from "@langchain/community/vectorstores/neo4j_vector";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Document } from "@langchain/core/documents";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
import { ApifyClient } from 'apify-client';
import Anthropic from "@anthropic-ai/sdk";
import graphlib, {Graph} from "@dagrejs/graphlib";
import neo4j, { Record } from "neo4j-driver"
import env from '#start/env'







const APIFY_APP_TOKEN = env.get('APIFY_APP_TOKEN')
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
    return items
}

function extractUserObjsFromPosts(posts: any) {
	const userObjs = []
	for (const post of posts) {
		userObjs.push(post["user"])
	}
	return userObjs
}

function extractUserObjFromPost(post: any) {
	return post["user"]
}

async function fetchFollowersTopPosts(userIds: any) {
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
        	return {"user": item["user"], "full_text": item.full_text}
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

async function isTopPostScienceOrAcademic(postText: any) {
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
    const userObjs = extractUserObjsFromPosts(topSciencePosts); // Implement extractUserIdsFromTweets function
    console.log("Step 2 USER LIST LENGTH: ", userObjs.length)


    // Step 4: Add nodes and edges to the followerGraph
    for (const userObj of userObjs) {
        followerGraph.setNode(userObj["screen_name"], { description:  userObj["description"]})
    }

    const followerGraphLibJSON = graphlib.json.write(followerGraph)

    console.log(followerGraphLibJSON)

    return followerGraph

}

// Function to create hypothetical following relationships
function createFollowingRelationships(userIds: any) {
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


const processTweets = async (tweets: any) => {
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


async function createRandomRelationships() {

	const session = driver.session();
    const getHandleNodesQuery = `
        MATCH (h:Handle)
        RETURN h
    `;

    try {
		// Fetching Handle nodes from Neo4j
		const handleNodesResult = await session.run(getHandleNodesQuery);

		// Constructing dictionary from Handle nodes
		const handleNodesDict = {};
		handleNodesResult.records.forEach(record => {
		    const handleNode = record.get('h').properties;
		    handleNodesDict[handleNode.id] = handleNode;
		});

		// Generating random source-target relationships
		const relationshipsDict = generateRandomRelationships(handleNodesDict, 10); // Adjust the number of relationships as needed

		console.log(relationshipsDict);

		// Creating relationships in Neo4j
		await createRelationships(session, relationshipsDict);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await session.close();
    }
}

function generateRandomRelationships(handleNodesDict, numRelationships) {
    const relationshipsDict = {};
    const handleNodeIds = Object.keys(handleNodesDict);

    const availableTargets = [...handleNodeIds]; // Create a copy of handleNodeIds for available targets

    for (let i = 0; i < numRelationships; i++) {
        const randomSourceIndex = Math.floor(Math.random() * handleNodeIds.length);
        const sourceId = handleNodeIds[randomSourceIndex];

        // Shuffle the availableTargets array to ensure randomness
        for (let j = availableTargets.length - 1; j > 0; j--) {
            const randomIndex = Math.floor(Math.random() * (j + 1));
            [availableTargets[j], availableTargets[randomIndex]] = [availableTargets[randomIndex], availableTargets[j]];
        }

        // Select a target that has not already been targeted
        let targetId;
        do {
            targetId = availableTargets.pop(); // Remove and get the last element from availableTargets
        } while (targetId === sourceId || relationshipsDict[targetId]); // Ensure the target is not the source and has not already been targeted

        relationshipsDict[`relationship${i}`] = { source: sourceId, target: targetId };
    }

    return relationshipsDict;
}
// Function to create relationships in Neo4j
async function createRelationships(session, relationshipsDict) {
    for (const [relationshipName, { source, target }] of Object.entries(relationshipsDict)) {
        const cypherQuery = `
            MATCH (a:Handle {id: $source}), (b:Handle {id: $target})
            CREATE (a)-[:FOLLOWS]->(b)
        `;

        try {
            await session.run(cypherQuery, { source, target });
            console.log(`Created FOLLOWS relationship from ${source} to ${target}`);
        } catch (error) {
            console.error(`Error creating FOLLOWS relationship: ${error}`);
        }
    }
}


export default class TweetsController {

	async index(ctx: HttpContextContract) {
	// ... your existing index method logic ...
	}

	async createInfluencerHandles({ request, response }: HttpContextContract) {
		// 1. Retrieve tweet data
		// const tweets = request.input('tweets') 
		const followerGraphLibObj =  await fetchFollowerGraph()

		const followerGraphLibJSON = graphlib.json.write(followerGraphLibObj)


		// Create params just to escape any issues with strings. 
		const createNodeQueries = followerGraphLibJSON.nodes.map(node => ({
		    query: `
		        MERGE (n:Handle {id: $nodeId}) 
		        ON CREATE SET n.description = $description`,
		    params: {
		        nodeId: node.v,
		        description: node.value.description || ''
		    }
		}));



		 const getHandleNodesQuery = `
			MATCH (h:Handle)
			RETURN h
    	`;
		
		const session = driver.session();
		let nodes = []
		try {
			
			// Create nodes
			for (const queryObj of createNodeQueries) {
				await session.run(queryObj.query, queryObj.params); 
			}
			const result = await session.run(getHandleNodesQuery);
	        nodes = result.records.map(record => record.get('h').properties);

		} catch(error) {
			console.log(error)
		} finally {
			await session.close()
		}

		return response.json(nodes) 


		// 3. Return the resulting handles
		
	}

	async generateRandomFollowsForAllHandles({ request, response }: HttpContextContract) {

		try {
			createRandomRelationships()
		} catch(error){
			console.log(error)
		}

		return response.json("relationships Created") 
	}

	async getAllHandlesWithFollowRelationships({ response }: HttpContextContract) {
	    const session = driver.session();

	    try {
	        const nodesResult = await session.run(`
	            MATCH (h:Handle)
	            RETURN h
	        `);

	        const edgesResult = await session.run(`
	            MATCH (h1:Handle)-[r:FOLLOWS]->(h2:Handle)
	            RETURN h1.id AS source, h2.id AS target
	        `);

	        const nodes = nodesResult.records.map(record => {
	            const node = record.get('h').properties;
	            return { id: node.id, data: { description: node.description || '' } };
	        });

	        const edges = edgesResult.records.map(record => ({
	            source: record.get('source'),
	            target: record.get('target'),
	            id: `${record.get('source')}-${record.get('target')}`
	        }));

	        const result = { influencers: { nodes, edges } };

	        return response.json(result);
	    } catch (error) {
	        console.log(error);
	        return response.status(500).json({ error: 'Internal Server Error' });
	    } finally {
	        await session.close();
	    }
	}

	async getTweetsByHandles({ request, response }: HttpContextContract) {
		try {
            const userInput = await request.body(); 
            const inputList = userInput.data.split(',')

            const client = new ApifyClient({
                token: process.env.APIFY_APP_TOKEN,
            });
            const anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_TOKEN,
            });
            
            let text = `What are the common themes/sentiments expressed in these tweets and what are some articles that could be written by a journalist based on these sentiments: \n`;
            
            // Prepare Actor input
            const input = {
                "handles": inputList,
                "tweetsDesired": 5,
                "addUserInfo": true,
                "startUrls": [],
                "proxyConfig": {
                    "useApifyProxy": true
                }
            };
        
            // Run the Actor and wait for it to finish
                const run = await client.actor("u6ppkMWAx2E2MpEuF").call(input);
        
            // Fetch and print Actor results from the run's dataset (if any)
                const { items } = await client.dataset(run.defaultDatasetId).listItems();
                items.forEach((item) => {
                    text += `${item.full_text} \n`
                });  
    
                const msg = await anthropic.messages.create({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1000,
                    temperature: 0.3,
                    messages: [
                        {
                            "role": "user",
                            "content": [
                            {
                                "type": "text",
                                "text": text
                            }
                            ]
                        }
                    ]});
                    console.log(msg)
                    response.status(200).send(msg.content[0].text);    
    } catch (error) {
            console.log('error', error);
    	}
	}

}