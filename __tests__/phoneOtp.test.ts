// phone-otp core with a fake database and a fake WhatsApp Cloud API. Proves
// that nothing is ever marked sent or verified without the provider's
// acceptance; real WhatsApp delivery is NOT verified by these tests.
import { OtpError, PROVIDER, sendCode, statusFor, templateMessage, whatsappConfig } from '../supabase/functions/phone-otp/otp';

const USER = '00000000-0000-0000-0000-000000000f04';
const CFG = { accessToken: 'test-token', phoneNumberId: '123', template: 'loption_code', language: 'fr', graphVersion: 'v21.0' };
const ISSUED = { verification_id: 'v1', phone_e164: '+212612345678', code: '482913', expires_at: '2026-11-07T12:10:00Z' };
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;

function setup(opts: { issueError?: object; send?: any; whatsapp?: typeof CFG | null } = {}) {
  const rpc = jest.fn(async (name: string) => {
    if (name === 'phone_otp_issue') {
      if (opts.issueError) throw opts.issueError;
      return ISSUED;
    }
    if (name === 'phone_otp_mark') return null;
    throw new Error('unexpected rpc ' + name);
  });
  const fetch = jest.fn(async () => {
    if (opts.send instanceof Error) throw opts.send;
    return opts.send ?? json(200, { messages: [{ id: 'wamid.ABC' }] });
  });
  return { rpc, fetch, deps: { rpc, fetch: fetch as any, whatsapp: opts.whatsapp === undefined ? CFG : opts.whatsapp, timeoutMs: 50 } };
}

async function reason(p: Promise<unknown>) {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return e instanceof OtpError ? e.reason : 'not an OtpError';
  }
}

describe('phone-otp', () => {
  it('sends the server-issued code with the WhatsApp authentication template and marks it sent; the code is not returned', async () => {
    const { deps, rpc, fetch } = setup();
    const r = await sendCode(USER, '06 12 34 56 78', deps);
    expect(r).toEqual({ verification_id: 'v1', phone_e164: '+212612345678', expires_at: '2026-11-07T12:10:00Z' });
    expect(JSON.stringify(r)).not.toContain('482913');
    expect(rpc).toHaveBeenNthCalledWith(1, 'phone_otp_issue', { p_user: USER, p_phone: '06 12 34 56 78' });
    const [url, init] = fetch.mock.calls[0] as any[];
    expect(url).toBe('https://graph.facebook.com/v21.0/123/messages');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body.to).toBe('212612345678');
    expect(body.template.name).toBe('loption_code');
    expect(body.template.components[0].parameters[0].text).toBe('482913');
    expect(rpc).toHaveBeenLastCalledWith('phone_otp_mark', { p_verification: 'v1', p_sent: true, p_provider: PROVIDER, p_detail: 'wamid.ABC' });
  });

  it('without WhatsApp credentials no code is issued (never a simulated success)', async () => {
    const { deps, rpc, fetch } = setup({ whatsapp: null });
    expect(await reason(sendCode(USER, '0612345678', deps))).toBe('provider_unavailable');
    expect(rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(statusFor('provider_unavailable')).toBe(503);
  });

  it.each([
    ['HTTP error', json(400, { error: { message: 'template not approved', code: 132001 } })],
    ['no message id', json(200, { messages: [] })],
    ['network down', new Error('ECONNRESET')],
  ])('provider failure (%s): the code is marked failed, so it can never verify the number', async (_label, send) => {
    const { deps, rpc } = setup({ send });
    expect(await reason(sendCode(USER, '0612345678', deps))).toBe('provider_failed');
    const mark = rpc.mock.calls.find((c) => c[0] === 'phone_otp_mark')!;
    expect((mark as any[])[1]).toMatchObject({ p_verification: 'v1', p_sent: false, p_provider: PROVIDER });
  });

  it('times out a slow provider and marks the code failed', async () => {
    const { deps, rpc } = setup();
    deps.fetch = jest.fn(
      (_url: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
    ) as any;
    expect(await reason(sendCode(USER, '0612345678', deps))).toBe('provider_failed');
    expect((rpc.mock.calls.find((c) => c[0] === 'phone_otp_mark') as any[])[1].p_sent).toBe(false);
  });

  it.each([
    [{ code: '22023', message: 'invalid phone number' }, 'invalid_phone', 422],
    [{ code: '54000', message: 'too many codes: wait one minute' }, 'rate_limited', 429],
  ])('database refusal %j -> %s, nothing sent', async (err, why, status) => {
    const { deps, fetch } = setup({ issueError: err });
    expect(await reason(sendCode(USER, '0522123456', deps))).toBe(why);
    expect(fetch).not.toHaveBeenCalled();
    expect(statusFor(why as any)).toBe(status);
  });

  it('reads the configuration from secrets and refuses an incomplete one', () => {
    const env = (m: Record<string, string>) => (n: string) => m[n];
    expect(whatsappConfig(env({ WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1' }))).toBeNull();
    expect(whatsappConfig(env({ WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_OTP_TEMPLATE: 'x' }))).toEqual({
      accessToken: 't', phoneNumberId: '1', template: 'x', language: 'fr', graphVersion: 'v21.0',
    });
    expect(templateMessage(CFG, '+212700000001', '123456').to).toBe('212700000001');
  });
});
