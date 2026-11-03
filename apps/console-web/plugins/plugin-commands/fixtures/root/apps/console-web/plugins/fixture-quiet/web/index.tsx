export const plugin = { register(rt: any) { rt.actions.register('fixture-quiet.ping', () => rt.toast('pong'), { label: 'Ping' }); } };
