/* eslint-env mocha */
/* eslint prefer-arrow-callback: "off" */

'use strict';

const assert = require('../util/assert');

const bcoin = require('bcoin');
const {Network} = bcoin;
const {hd} = bcoin;

const MultisigClient = require('bmultisig-client');
const {WalletClient} = require('bclient');

const NETWORK_NAME = 'regtest';
const API_KEY = 'foo';
const ADMIN_TOKEN = Buffer.alloc(32, 1).toString('hex');
const network = Network.get(NETWORK_NAME);

console.warn('Integration test configs:');
console.warn(`  NETWORK must be ${NETWORK_NAME}`);
console.warn(`  API_KEY must be ${API_KEY}.`);
console.warn(`  ADMIN_TOKEN must be ${ADMIN_TOKEN}.`);
console.warn('  WALLET_AUTH must be TRUE');

const TEST_XPUB_PATH = 'm/44\'/0\'/0\'';

const WALLET_OPTIONS = {
  m: 2,
  n: 2,
  id: 'test'
};

describe('HTTP', function () {
  let adminClient;
  let multisigClient;
  let walletAdminClient;
  let testWalletClient1;
  let testWalletClient2;
  let joinKey;

  const priv1 = getPrivKey().derivePath(TEST_XPUB_PATH);
  const priv2 = getPrivKey().derivePath(TEST_XPUB_PATH);
  const xpub1 = priv1.toPublic();
  const xpub2 = priv2.toPublic();

  beforeEach(async () => {
    adminClient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: ADMIN_TOKEN
    });

    multisigClient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY
    });

    walletAdminClient = new WalletClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: ADMIN_TOKEN
    });
  });

  it('should create multisig wallet', async () => {
    const xpub = xpub1.xpubkey(network);

    const cosignerName = 'cosigner1';
    const id = WALLET_OPTIONS.id;

    const walletOptions = Object.assign({
      cosignerName, xpub
    }, WALLET_OPTIONS);

    const wallet = await multisigClient.createWallet(id, walletOptions);
    const multisigWallets = await adminClient.getWallets();
    const wallets = await walletAdminClient.getWallets();

    assert.strictEqual(wallet.wid, 1);
    assert.strictEqual(wallet.id, id);
    assert.strictEqual(wallet.cosigners.length, 1);
    assert.strictEqual(wallet.m, 2);
    assert.strictEqual(wallet.n, 2);

    const cosigner = wallet.cosigners[0];
    assert.strictEqual(cosigner.name, 'cosigner1');
    assert.strictEqual(cosigner.path, '');
    assert.strictEqual(cosigner.token.length, 64);
    assert.strictEqual(cosigner.tokenDepth, 0);

    joinKey = wallet.joinKey;

    testWalletClient1 = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: cosigner.token
    });

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, [id]);

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', id]);
  });

  it('should fail getting multisig wallet - non authenticated', async () => {
    const msclient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY
    });

    let err;
    try {
      await msclient.getInfo('test');
    } catch (e) {
      err = e;
    }

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
  });

  it('should join multisig wallet', async () => {
    const xpub = xpub2.xpubkey(network);
    const cosignerName = 'cosigner2';

    const mswallet = await multisigClient.join(WALLET_OPTIONS.id, {
      cosignerName, joinKey, xpub
    });

    assert(mswallet, 'Did not return multisig wallet.');
    assert.strictEqual(mswallet.wid, 1);
    assert.strictEqual(mswallet.id, 'test');
    assert.strictEqual(mswallet.cosigners.length, 2);
    assert.strictEqual(mswallet.initialized, true);

    const cosigners = mswallet.cosigners;

    assert.deepStrictEqual(cosigners[0], {
      id: 0,
      name: 'cosigner1'
    });

    assert.notTypeOf(cosigners[1].token, 'null');

    testWalletClient2 = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: cosigners[1].token
    });

    assert.deepStrictEqual(cosigners[1], Object.assign({
      id: 1,
      name: 'cosigner2',
      path: '',
      tokenDepth: 0
    }, {
      token: cosigners[1].token
    }));
  });

  it('should get multisig wallet by id', async () => {
    const multisigWallet = await testWalletClient1.getInfo('test');

    assert(multisigWallet, 'Can not get multisig wallet.');
    assert.strictEqual(multisigWallet.wid, 1);
    assert.strictEqual(multisigWallet.id, 'test');

    assert.strictEqual(multisigWallet.initialized, true);
    assert.strictEqual(multisigWallet.cosigners.length, 2);
    assert.deepEqual(multisigWallet.cosigners, [
      { id: 0, name: 'cosigner1' },
      { id: 1, name: 'cosigner2' }
    ]);

    // with details
    const msWalletDetails = await testWalletClient1.getInfo('test', true);
    const account = msWalletDetails.account;

    assert(msWalletDetails, 'Can not get multisig wallet');
    assert.strictEqual(msWalletDetails.wid, multisigWallet.wid);
    assert.strictEqual(msWalletDetails.id, multisigWallet.id);
    assert.strictEqual(msWalletDetails.initialized, true);

    assert(account, 'Could not get account details');
    assert.strictEqual(account.watchOnly, true);
    assert.strictEqual(account.initialized, msWalletDetails.initialized);
    assert(account.receiveAddress);
    assert(account.changeAddress);
    assert(account.nestedAddress);
    assert.strictEqual(account.keys.length, msWalletDetails.n);
  });

  it('should return null on non existing wallet', async () => {
    const nonMultisigWallet = await multisigClient.getInfo('primary');
    const nowallet = await multisigClient.getInfo('nowallet');

    assert.typeOf(nonMultisigWallet, 'null');
    assert.typeOf(nowallet, 'null');
  });

  it('should list multisig wallets', async () => {
    const multisigWallets = await adminClient.getWallets();
    const wallets = await walletAdminClient.getWallets();

    assert(Array.isArray(wallets));
    assert.strictEqual(wallets.length, 2);
    assert.deepEqual(wallets, ['primary', 'test']);

    assert(Array.isArray(multisigWallets));
    assert.strictEqual(multisigWallets.length, 1);
    assert.deepEqual(multisigWallets, ['test']);
  });

  it('should rescan db', async () => {
    const rescan = await adminClient.rescan(0);

    assert(rescan);
    assert.strictEqual(rescan.success, true);
  });

  it('should get wallet balance(proxy)', async () => {
    // no auth
    let err;
    try {
      await multisigClient.getBalance(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    // admin
    const balance1 = await adminClient.getBalance(WALLET_OPTIONS.id);

    // cosigner auth
    const balance2 = await testWalletClient1.getBalance(WALLET_OPTIONS.id);

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
    assert(balance1);
    assert(balance2);
  });

  it('should fail to get balance(proxy) with incorrect token', async () => {
    const msclient = new MultisigClient({
      port: network.walletPort,
      apiKey: API_KEY,
      token: Buffer.alloc(32).toString('hex')
    });

    let err;
    try {
      await msclient.getBalance(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    assert(err);
    assert(err.message, 'Authentication error.');
  });

  it('should get coin (proxy)', async () => {
    let err;

    try {
      await multisigClient.getCoins(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    const coins1 = await adminClient.getCoins(WALLET_OPTIONS.id);
    const coins2 = await testWalletClient1.getCoins(WALLET_OPTIONS.id);

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
    assert.strictEqual(coins1.length, 0);
    assert.strictEqual(coins2.length, 0);
  });

  it('should get address (proxy)', async () => {
    let err;

    try {
      await multisigClient.createAddress(WALLET_OPTIONS.id);
    } catch (e) {
      err = e;
    }

    const addr1 = await adminClient.createAddress(WALLET_OPTIONS.id);
    const addr2 = await testWalletClient2.createAddress(WALLET_OPTIONS.id);

    assert(err);
    assert.strictEqual(err.message, 'Authentication error.');
    assert(addr1);
    assert(addr2);

    assert.strictEqual(addr1.index, 1);
    assert.strictEqual(addr2.index, 2);
    assert.strictEqual(addr1.name, 'default');
    assert.strictEqual(addr2.name, 'default');
    assert.strictEqual(addr1.account, 0);
    assert.strictEqual(addr2.account, 0);
  });

  // TODO: Add funding tests

  it('should delete multisig wallet', async () => {
    const id = 'test';
    const multisigWalletsBefore = await adminClient.getWallets();
    const walletsBefore = await walletAdminClient.getWallets();
    const removed = await adminClient.removeWallet(id);
    const multisigWalletsAfter = await adminClient.getWallets();
    const walletsAfter = await walletAdminClient.getWallets();

    assert.strictEqual(removed, true, 'Could not remove wallet');
    assert.deepEqual(multisigWalletsBefore, [id]);
    assert.deepEqual(multisigWalletsAfter, []);
    assert.deepEqual(walletsBefore, ['primary', id]);
    assert.deepEqual(walletsAfter, ['primary']);
  });

  it('should fail deleting non existing multisig wallet', async () => {
    const removed = await adminClient.removeWallet('nowallet');
    const removedPrimary = await adminClient.removeWallet('primary');

    assert.strictEqual(removed, false, 'Removed non existing wallet');
    assert.strictEqual(removedPrimary, false, 'Can not remove primary wallet');
  });
});

/*
 * Helpers
 */

function getPrivKey() {
  return hd.PrivateKey.generate();
}

