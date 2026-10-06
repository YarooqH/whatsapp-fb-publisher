import { config } from './config.js';

/**
 * Buffer modern GraphQL API (https://developers.buffer.com)
 * Endpoint: POST https://api.buffer.com   Auth: Authorization: Bearer <API key>
 *
 * Data model: Account → Organizations → Channels (one channel = one connected
 * social account, e.g. a Facebook Page) → Posts.
 *
 * The legacy REST API (api.bufferapp.com/1/…) is being retired on 2027-02-01;
 * this module only uses the GraphQL API.
 */

const GRAPHQL_ENDPOINT = 'https://api.buffer.com';

/** Core GraphQL request. Throws on transport/GraphQL-level errors. */
async function graphql(query, apiKey = config.bufferApiKey) {
  let res;
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query }),
    });
  } catch (e) {
    throw new Error(`Cannot reach Buffer API: ${e.message}`);
  }

  const body = await res.json().catch(() => ({}));

  // Non-recoverable / transport errors (UNAUTHORIZED, RATE_LIMIT_EXCEEDED, …)
  if (!res.ok || body.errors) {
    const err = body.errors?.[0];
    const code = err?.extensions?.code || res.status;
    throw new Error(`Buffer API error (${code}): ${err?.message || `HTTP ${res.status}`}`);
  }
  return body.data;
}

/** List organizations tied to the API key. */
export async function getOrganizations(apiKey) {
  const data = await graphql(
    `{ account { organizations { id name } } }`,
    apiKey
  );
  return data?.account?.organizations ?? [];
}

/** List channels (connected social accounts) inside an organization. */
export async function getChannels(orgId, apiKey) {
  const data = await graphql(
    `{ channels(input: { organizationId: "${orgId}" }) { id name service } }`,
    apiKey
  );
  return data?.channels ?? [];
}

/**
 * Create a post on a Buffer channel.
 * @param {string} text
 * @param {{channelId:string, dueAt?:Date, apiKey?:string, imageUrl?:string}} opts
 * @returns {Promise<{id:string, text?:string, dueAt?:string}>}
 */
export async function publishToBuffer(text, { channelId, dueAt, apiKey, imageUrl } = {}) {
  if (dueAt && dueAt.getTime() <= Date.now()) {
    throw new Error('Scheduled time must be in the future');
  }

  const mode = dueAt ? 'customScheduled' : 'shareNow';
  const dueAtField = dueAt
    ? `,\n      dueAt: ${JSON.stringify(dueAt.toISOString())}`
    : '';
  const assetsField = imageUrl
    ? `,\n      assets: [{ image: { url: ${JSON.stringify(imageUrl)} } }]`
    : '';

  const query = `mutation {
    createPost(input: {
      text: ${JSON.stringify(text || '')},
      channelId: ${JSON.stringify(channelId)},
      metadata: { facebook: { type: post } },
      schedulingType: automatic,
      mode: ${mode}${dueAtField}${assetsField}
    }) {
      ... on PostActionSuccess { post { id text dueAt } }
      ... on LimitReachedError { message }
      ... on InvalidInputError { message }
      ... on MutationError { message }
    }
  }`;

  const data = await graphql(query, apiKey);
  const result = data?.createPost;
  if (!result?.post) {
    throw new Error(result?.message || 'Buffer rejected the post (unknown reason)');
  }
  return result.post;
}

/**
 * Resolve org + Facebook channel for posting, auto-selecting when unambiguous.
 * Fail-fast with actionable messages — used at startup and by #profiles.
 * @returns {Promise<{org:{id:string,name:string}, channel:{id:string,name:string}, channels:Array}>}
 */
export async function resolveBufferTarget() {
  const orgs = await getOrganizations();
  if (!orgs.length) {
    throw new Error('No Buffer organizations on this API key. Get one at publish.buffer.com.');
  }

  let org;
  if (config.bufferOrgId) {
    org = orgs.find((o) => o.id === config.bufferOrgId);
    if (!org) {
      throw new Error(
        `BUFFER_ORG_ID "${config.bufferOrgId}" not found. Yours: ${orgs.map((o) => `${o.id} (${o.name})`).join(', ')}`
      );
    }
  } else if (orgs.length === 1) {
    org = orgs[0]; // unambiguous → auto-select
  } else {
    throw new Error(
      `Multiple Buffer organizations — set BUFFER_ORG_ID to one of: ${orgs.map((o) => `${o.id} (${o.name})`).join(', ')}`
    );
  }

  const channels = (await getChannels(org.id)).filter((c) => c.service === 'facebook');
  if (!channels.length) {
    throw new Error(
      `No Facebook page connected to Buffer yet — connect one in Buffer UI (Channels → Add Channel → Facebook Page), then try again.`
    );
  }

  let channel;
  if (config.bufferChannelId) {
    channel = channels.find((c) => c.id === config.bufferChannelId);
    if (!channel) {
      throw new Error(
        `BUFFER_CHANNEL_ID "${config.bufferChannelId}" not found among your FB pages: ${channels.map((c) => `${c.id} (${c.name})`).join(', ')}`
      );
    }
  } else if (channels.length === 1) {
    channel = channels[0]; // unambiguous → auto-select
  } else {
    throw new Error(
      `Multiple Facebook pages connected — set BUFFER_CHANNEL_ID to one of: ${channels.map((c) => `${c.id} (${c.name})`).join(', ')}`
    );
  }

  return { org, channel, channels };
}