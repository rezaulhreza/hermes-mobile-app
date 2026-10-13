/** The helper models, the user's endpoints and the memory of the active workspace. */

import { atom } from 'nanostores'

import { type Endpoint, endpointRows, type HelperTask, helperTasks, type MemoryChoice, memoryChoices } from '@/core/host-settings'
import { tidySecret } from '@/core/providers'

import { currentApi } from './link'

export const $helperTasks = atom<HelperTask[] | null>(null)
export const $endpoints = atom<Endpoint[] | null>(null)
export const $memory = atom<MemoryChoice[] | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

export async function loadHelperTasks(): Promise<void> {
  $helperTasks.set(helperTasks(await api().request({ path: '/api/model/auxiliary' })))
}

/** Give a helper job a model, or the host's own choice with `auto` and no model. */
export async function setHelperModel(task: string, provider: string, model: string): Promise<void> {
  await api().request({ path: '/api/model/set', method: 'POST', body: { scope: 'auxiliary', task, provider, model }, timeoutMs: 60_000 })
  await loadHelperTasks()
}

export async function loadEndpoints(): Promise<void> {
  $endpoints.set(endpointRows(await api().request({ path: '/api/providers/custom-endpoints' })))
}

export interface EndpointForm {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}

function endpointBody(form: EndpointForm) {
  return { name: form.name.trim(), base_url: form.baseUrl.trim(), model: form.model.trim(), ...(form.apiKey.trim() ? { api_key: tidySecret(form.apiKey) } : {}) }
}

/** Ask the host to reach the endpoint. Resolves with the models it lists, or throws with the host's sentence. */
export async function checkEndpoint(form: EndpointForm): Promise<string[]> {
  const result = await api().request<{ ok?: boolean; message?: string; models?: string[] }>({
    path: '/api/providers/custom-endpoints/validate',
    method: 'POST',
    body: endpointBody(form),
    timeoutMs: 60_000
  })

  if (!result.ok) {
    throw new Error(result.message || 'The host could not reach this endpoint.')
  }

  return result.models ?? []
}

export async function saveEndpoint(form: EndpointForm): Promise<void> {
  await api().request({ path: '/api/providers/custom-endpoints', method: 'POST', body: endpointBody(form), timeoutMs: 60_000 })
  await loadEndpoints()
}

/** Make Hermes run on this endpoint from the next chat. */
export async function runOnEndpoint(id: string): Promise<void> {
  await api().request({ path: `/api/providers/custom-endpoints/${encodeURIComponent(id)}/activate`, method: 'POST', timeoutMs: 60_000 })
  await loadEndpoints()
}

export async function removeEndpoint(id: string): Promise<void> {
  await api().request({ path: `/api/providers/custom-endpoints/${encodeURIComponent(id)}`, method: 'DELETE' })
  await loadEndpoints()
}

export async function loadMemory(): Promise<void> {
  $memory.set(memoryChoices(await api().request({ path: '/api/memory' })))
}

/** Choose the memory of the host. An empty name is the built-in memory. */
export async function setMemory(name: string): Promise<void> {
  await api().request({ path: '/api/memory/provider', method: 'PUT', body: { provider: name }, timeoutMs: 60_000 })
  await loadMemory()
}

/**
 * Ask the provider if it takes this key, before the host stores it. Throws
 * with the host's sentence for a key the provider refused. A check that
 * could not run (no network on the host) lets the save go on.
 */
export async function checkProviderKey(envName: string, key: string): Promise<void> {
  if (!envName) {
    return
  }

  const result = await api()
    .request<{ ok?: boolean; reachable?: boolean; message?: string }>({ path: '/api/providers/validate', method: 'POST', body: { key: envName, value: tidySecret(key) }, timeoutMs: 60_000 })
    .catch(() => null)

  if (result && !result.ok && result.reachable !== false) {
    throw new Error(result.message || 'The provider did not take this key.')
  }
}

export function clearHostSettings(): void {
  $helperTasks.set(null)
  $endpoints.set(null)
  $memory.set(null)
}
