// Invalidate published-data caches only after the atomic remote reset succeeds.
// Do this before local cleanup, which can fail independently of the remote commit.
export async function resetPublishedData(client, invalidate) {
    const { error } = await client.rpc("saipher_reset_business_data");
    if (error) throw new Error(`Supabase reset was not completed: ${error.message}`);
    invalidate();
}
