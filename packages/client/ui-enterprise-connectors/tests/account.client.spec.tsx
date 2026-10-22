// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConnectorAccountForm } from '../src/client/ConnectorAccountForm.tsx'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const t = makeTranslate(zh)

it('asks for the server update when its employee OAuth relay is unavailable', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'OAUTH_SERVER_UPDATE_REQUIRED' }, { status: 400 })))
  render(
    <ConnectorAccountForm
      id="notion"
      configured={false}
      t={t}
      onChanged={vi.fn()}
      account={{
        kind: 'credentials',
        configured: false,
        configuration: 'config',
        revision: '',
        type: 'oauth',
        owner: 'employee',
        status: 'disconnected',
        fields: [],
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: zh.oauthConnect }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.oauthServerUpdateRequired)
  expect(screen.getByRole('alert').textContent).toMatchSnapshot()
})

it('identifies a missing enterprise OAuth callback without blaming employee credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'OAUTH_CALLBACK_UNAVAILABLE' }, { status: 503 })))
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  try {
    render(
      <ConnectorAccountForm
        id="notion"
        configured={false}
        t={t}
        onChanged={vi.fn()}
        account={{
          kind: 'credentials',
          configured: false,
          configuration: 'config',
          revision: '',
          type: 'oauth',
          owner: 'employee',
          status: 'disconnected',
          fields: [],
        }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh.oauthConnect }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh.oauthCallbackUnavailable)
    expect(screen.getByRole('alert').textContent).toMatchSnapshot()
    expect(open).not.toHaveBeenCalled()
  } finally {
    open.mockRestore()
  }
})

it('submits only the current connector account and clears credentials after success', async () => {
  const changed = vi.fn()
  const request = vi.fn().mockResolvedValue(Response.json({ configured: true }))
  vi.stubGlobal('fetch', request)
  render(<ConnectorAccountForm id="wechat" configured={false} t={t} onChanged={changed} />)
  expect(screen.getByRole('button', { name: zh.accountSave }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(zh.accountRequiredHint).parentElement?.textContent).toMatchSnapshot()
  fireEvent.change(screen.getByLabelText('AppID'), { target: { value: 'fixture-id' } })
  fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'fixture-secret' } })
  fireEvent.click(screen.getByRole('button', { name: zh.accountSave }))
  await waitFor(() => {
    expect(changed).toHaveBeenCalledWith(zh.accountSaved)
  })
  expect(request).toHaveBeenCalledWith(
    '/api/lfclaw/connector-account?id=wechat',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ operation: 'save', appId: 'fixture-id', appSecret: 'fixture-secret' }),
    }),
  )
  expect(screen.getByLabelText<HTMLInputElement>('AppSecret').value).toBe('')
})

it('keeps failed input and aborts a pending save when the account form closes', async () => {
  const pending = Promise.withResolvers<Response>()
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 'ACCOUNT_CONNECTION_FAILED' }, { status: 502 }))
    .mockImplementationOnce(() => pending.promise)
  vi.stubGlobal('fetch', request)
  const changed = vi.fn()
  const view = render(<ConnectorAccountForm id="wechat" configured t={t} onChanged={changed} />)
  fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'new-fixture-secret' } })
  fireEvent.click(screen.getByRole('button', { name: zh.accountSave }))
  expect((await screen.findByRole('alert')).textContent).toBe(zh.accountFailed)
  expect(screen.getByLabelText<HTMLInputElement>('AppSecret').value).toBe('new-fixture-secret')
  fireEvent.click(screen.getByRole('button', { name: zh.accountSave }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2)
  })
  const init = request.mock.calls[1]![1] as RequestInit
  view.unmount()
  expect(init.signal?.aborted).toBe(true)
  pending.resolve(Response.json({ configured: true }))
  await pending.promise
  expect(changed).not.toHaveBeenCalled()
})
