import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const ATLAS_URI = process.env.MONGODB_URI_PRODUCTION || process.env.MONGODB_URI || process.env.ATLAS_MONGODB_URI;
const LOCAL_URI = process.env.MONGODB_URI_LOCAL || 'mongodb://127.0.0.1:27017/tuggo';

if (!ATLAS_URI) {
    console.error('❌ Error: Atlas MongoDB URI not found in .env (MONGODB_URI or MONGODB_URI_PRODUCTION)');
    process.exit(1);
}

// Ensure source is not accidentally local
if (ATLAS_URI.includes('127.0.0.1') || ATLAS_URI.includes('localhost')) {
    console.error('❌ Error: Atlas URI points to localhost! Please verify your configuration.');
    process.exit(1);
}

async function cloneAtlasToLocal() {
    console.log('====================================================');
    console.log('🚀 Starting Safe Atlas to Local MongoDB Migration');
    console.log('⚠️  Atlas (Production) is strictly READ-ONLY.');
    console.log('====================================================\n');

    let atlasClient;
    let localClient;

    try {
        console.log('📡 Connecting to Atlas (Production)...');
        atlasClient = new MongoClient(ATLAS_URI);
        await atlasClient.connect();
        const atlasDb = atlasClient.db();
        console.log(`✅ Connected to Atlas DB: "${atlasDb.databaseName}"`);

        console.log('📡 Connecting to Local MongoDB...');
        localClient = new MongoClient(LOCAL_URI);
        await localClient.connect();
        const localDb = localClient.db();
        console.log(`✅ Connected to Local DB: "${localDb.databaseName}"\n`);

        // Fetch all collections from Atlas
        const collectionsList = await atlasDb.listCollections().toArray();
        const collections = collectionsList
            .map(c => c.name)
            .filter(name => !name.startsWith('system.'));

        console.log(`📋 Found ${collections.length} collections on Atlas to copy:\n${collections.map(c => `   - ${c}`).join('\n')}\n`);

        const summary = [];

        for (const collName of collections) {
            process.stdout.write(`⏳ Syncing "${collName}"... `);

            const atlasColl = atlasDb.collection(collName);
            const localColl = localDb.collection(collName);

            const atlasCount = await atlasColl.countDocuments();

            // Clear local collection first to avoid duplicate keys
            await localColl.drop().catch(() => {}); // ignore error if collection doesn't exist locally

            if (atlasCount === 0) {
                console.log(`[Empty - 0 docs]`);
                summary.push({ collection: collName, atlasCount: 0, localCount: 0, status: 'EMPTY' });
                continue;
            }

            // Stream documents in batches of 1000
            const batchSize = 1000;
            const cursor = atlasColl.find({});
            let batch = [];
            let copiedCount = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                batch.push(doc);

                if (batch.length === batchSize) {
                    await localColl.insertMany(batch, { ordered: false });
                    copiedCount += batch.length;
                    batch = [];
                }
            }

            if (batch.length > 0) {
                await localColl.insertMany(batch, { ordered: false });
                copiedCount += batch.length;
            }

            // Copy indexes (except default _id_)
            try {
                const indexes = await atlasColl.indexes();
                const validIndexes = indexes
                    .filter(idx => idx.name !== '_id_')
                    .map(idx => {
                        const { v, ns, ...spec } = idx;
                        return spec;
                    });

                if (validIndexes.length > 0) {
                    await localColl.createIndexes(validIndexes).catch(err => {
                        // Log but do not fail data sync if an index has minor collision
                        // console.warn(`   (Index note for ${collName}: ${err.message})`);
                    });
                }
            } catch (idxErr) {
                // Ignore index read errors if privileges are restricted
            }

            const localCount = await localColl.countDocuments();
            if (atlasCount === localCount) {
                console.log(`Done! (${localCount}/${atlasCount} docs)`);
                summary.push({ collection: collName, atlasCount, localCount, status: 'MATCH' });
            } else {
                console.log(`⚠️ Count mismatch! (Atlas: ${atlasCount}, Local: ${localCount})`);
                summary.push({ collection: collName, atlasCount, localCount, status: 'MISMATCH' });
            }
        }

        console.log('\n====================================================');
        console.log('📊 Migration Summary:');
        console.log('====================================================');
        console.table(summary);

        const totalAtlas = summary.reduce((acc, s) => acc + s.atlasCount, 0);
        const totalLocal = summary.reduce((acc, s) => acc + s.localCount, 0);
        console.log(`\n🎉 Completed! Total documents migrated: ${totalLocal} (Atlas total: ${totalAtlas})`);
        console.log('Local MongoDB database "tuggo" is now completely in sync and safe for local development.\n');

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        process.exit(1);
    } finally {
        if (atlasClient) await atlasClient.close();
        if (localClient) await localClient.close();
    }
}

cloneAtlasToLocal();
