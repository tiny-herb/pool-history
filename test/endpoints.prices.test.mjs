import test from 'node:test';
import assert from 'node:assert/strict';

import {
  videosUrl,
  imageEndpointsUrl,
  videoModelPrices,
  imageEndpointPrices
} from '../src/endpoints.mjs';

test('the video list and an image model\'s endpoints are read from their own URLs', () => {
  assert.equal(videosUrl(), 'https://openrouter.ai/api/v1/videos/models');
  assert.equal(
    imageEndpointsUrl('openai/gpt-image-2'),
    'https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints'
  );
});

test('a video model\'s SKUs become prices per second, by audio and resolution', () => {
  const json = {
    data: [
      {
        id: 'google/veo-3.1',
        canonical_slug: 'google/veo-3.1-20260320',
        name: 'Google: Veo 3.1',
        generate_audio: true,
        pricing_skus: {
          duration_seconds_with_audio: '0.40',
          duration_seconds_with_audio_4k: '0.60',
          duration_seconds_without_audio: '0.20',
          duration_seconds_without_audio_4k: '0.40'
        },
        allowed_passthrough_parameters: []
      },
      {
        id: 'runway/aleph-2',
        name: 'Runway: Aleph 2',
        pricing_skus: { cents_per_second_output: '28', minimum_cents_per_generation: '56' }
      },
      {
        id: 'bytedance/seedance-2.5',
        name: 'ByteDance: Seedance 2.5',
        pricing_skus: {
          video_tokens: '0.0000107',
          video_tokens_1080p: '0.0000117',
          video_tokens_without_audio: '0.0000107',
          video_tokens_with_video_input: '0.0000064',
          video_tokens_1080p_with_video_input: '0.000007'
        }
      },
      {
        id: 'kwaivgi/kling-v3.0-pro',
        name: 'Kling v3.0 Pro',
        pricing_skus: {
          duration_seconds: '0.112',
          text_to_video_duration_seconds_480p: '0.112',
          image_to_video_duration_seconds_1080p: '0.112'
        }
      }
    ]
  };

  const prices = videoModelPrices(json);
  assert.deepEqual(prices.get('google/veo-3.1'), {
    duration_seconds_with_audio: { unit: 'second-with-audio', usd: 0.4 },
    duration_seconds_with_audio_4k: { unit: 'second-with-audio', usd: 0.6, detail: '4K' },
    duration_seconds_without_audio: { unit: 'second-without-audio', usd: 0.2 },
    duration_seconds_without_audio_4k: { unit: 'second-without-audio', usd: 0.4, detail: '4K' }
  });
  assert.deepEqual(prices.get('runway/aleph-2'), {
    cents_per_second_output: { unit: 'second', usd: 0.28 },
    minimum_cents_per_generation: { unit: 'video-minimum', usd: 0.56 }
  });
  assert.deepEqual(prices.get('bytedance/seedance-2.5'), {
    video_tokens: { unit: 'video-tokens', usd: 10.7 },
    video_tokens_1080p: { unit: 'video-tokens', usd: 11.7, detail: '1080p' },
    video_tokens_without_audio: { unit: 'video-tokens', usd: 10.7, detail: 'without audio' },
    video_tokens_with_video_input: { unit: 'video-tokens', usd: 6.4, detail: 'with video input' },
    video_tokens_1080p_with_video_input: { unit: 'video-tokens', usd: 7, detail: 'with video input, 1080p' }
  });
  assert.deepEqual(prices.get('kwaivgi/kling-v3.0-pro'), {
    duration_seconds: { unit: 'second', usd: 0.112 },
    text_to_video_duration_seconds_480p: { unit: 'second', usd: 0.112, detail: 'text to video, 480p' },
    image_to_video_duration_seconds_1080p: { unit: 'second', usd: 0.112, detail: 'image to video, 1080p' }
  });
});

test('a SKU the tables do not know is kept under its own key with the number as listed', () => {
  const prices = videoModelPrices({
    data: [
      {
        id: 'minimax/hailuo-3',
        name: 'MiniMax: Hailuo 3',
        pricing_skus: { duration_seconds: '0.13', reference_images: '0.04' }
      },
      {
        id: 'heygen/heygen-video-1',
        name: 'HeyGen: Video 1',
        pricing_skus: { duration_seconds_2k: '0.1', long_duration_seconds_2k: '0.105', duration_seconds: 'n/a' }
      }
    ]
  });

  assert.deepEqual(prices.get('minimax/hailuo-3'), {
    duration_seconds: { unit: 'second', usd: 0.13 },
    reference_images: { unit: null, value: 0.04 }
  });
  assert.deepEqual(prices.get('heygen/heygen-video-1'), {
    duration_seconds_2k: { unit: 'second', usd: 0.1, detail: '2K' },
    long_duration_seconds_2k: { unit: null, value: 0.105 },
    duration_seconds: { unit: null, value: 'n/a' }
  });
});

test('an image endpoint\'s prices keep the unit each is billed in, by provider tag', () => {
  const gptImage = {
    id: 'openai/gpt-image-2',
    endpoints: [{
      provider_name: 'OpenAI',
      provider_slug: 'openai',
      provider_tag: 'openai',
      supported_parameters: { n: { type: 'range', min: 1, max: 10 } },
      allowed_passthrough_parameters: ['moderation'],
      supports_streaming: true,
      pricing: [
        { billable: 'input_image', unit: 'token', cost_usd: 0.000008 },
        { billable: 'input_text', unit: 'token', cost_usd: 0.000005 },
        { billable: 'output_image', unit: 'token', cost_usd: 0.00003 }
      ]
    }]
  };
  assert.deepEqual(imageEndpointPrices(gptImage).get('openai'), {
    'input_image:token': { unit: 'input-image-tokens', usd: 8 },
    'input_text:token': { unit: 'input-text-tokens', usd: 5 },
    'output_image:token': { unit: 'output-image-tokens', usd: 30 }
  });

  const kreaEdit = {
    id: 'krea/k3-edit',
    endpoints: [{
      provider_name: 'Krea',
      provider_slug: 'krea',
      provider_tag: 'krea',
      supports_streaming: false,
      pricing: [
        { billable: 'output_image', unit: 'image', cost_usd: 0.03 },
        { billable: 'output_image', unit: 'image', cost_usd: 0.06, variant: '2k' },
        { billable: 'input_image', unit: 'image', cost_usd: 0.02 },
        { billable: 'input_image', unit: 'image', cost_usd: 0.07, variant: '2k' },
        { billable: 'output_image', unit: 'request', cost_usd: 0.02, variant: 'high_thinking_surcharge' },
        { billable: 'input_font', unit: 'image', cost_usd: 0.01 }
      ]
    }]
  };
  assert.deepEqual(imageEndpointPrices(kreaEdit).get('krea'), {
    'output_image:image': { unit: 'image', usd: 0.03 },
    'output_image:image:2k': { unit: 'image', usd: 0.06, detail: '2K' },
    'input_image:image': { unit: 'input-image', usd: 0.02 },
    'input_image:image:2k': { unit: 'input-image', usd: 0.07, detail: '2K' },
    'output_image:request:high_thinking_surcharge': { unit: 'request', usd: 0.02, detail: 'high thinking surcharge' },
    'input_font:image': { unit: null, value: 0.01 }
  });
});
