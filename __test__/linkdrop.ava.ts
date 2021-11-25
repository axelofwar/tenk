import { Workspace, tGas, NearAccount } from "near-willem-workspaces-ava";
import { NEAR, Gas } from "near-units";
import {
  ActualTestnet,
  createLinkdrop,
  getTokens,
  checkKey,
  BalanceDelta,
  claim,
  claim_raw,
  repeat,
  zeroDelta,
  hasDelta,
  getDelta,
} from "./util";

const base_cost = NEAR.parse("1 N");
const min_cost = NEAR.parse("0.01 N");

const runner = Workspace.init(
  { initialBalance: NEAR.parse("15 N").toString() },
  async ({ root }) => {
    const network: NearAccount = Workspace.networkIsTestnet()
      ? // Just need accountId "testnet"
        new ActualTestnet("testnet")
      : // Otherwise use fake linkdrop acconut on sandbox
        await root.createAccountFrom({
          testnetContract: "testnet",
          withData: false,
        });
    const owner_id = root;
    const tenk = await root.createAndDeploy(
      "tenk",
      `${__dirname}/../target/wasm32-unknown-unknown/release/tenk.wasm`,
      {
        method: "new_default_meta",
        args: {
          owner_id,
          name: "meerkats",
          symbol: "N/A",
          uri: "QmaDR7ozkawfnmEirvErfcJm27FEyFv5U1KQDfWkHGj5qD",
          size: 10_000,
          base_cost,
          min_cost,
        },
        gas: Gas.parse("20 TGas"),
      }
    );

    return { tenk };
  }
);

runner.test(
  "Use `claim` to send to existing account",
  async (t, { root, tenk }) => {
    const alice = await root.createAccount("alice");

    // Create temporary keys for access key on linkdrop
    const [delta, _] = await getDelta(t, tenk, async () => {
      const senderKey = await createLinkdrop(t, tenk, root);
      await claim(tenk, alice, senderKey);
      t.assert(
        !(await checkKey(senderKey.getPublicKey(), tenk)),
        "key should not exist"
      );
    });
    await delta.isGreaterOrEqual(NEAR.from(0));
    const tokens = await getTokens(tenk, alice);
    t.assert(tokens.length == 1, "should contain only one token");
    t.log(
      `Balance to contract ${
        tenk.accountId
      } after linkdrop is claimed ${await delta.toHuman()}`
    );

    // await deployEmpty(tenk);
  }
);

// TODO: there is a race condition on the key store.  Either need multiple keys per account,
// runner.test(
//   "Use `claim` to send to existing account back-to-back",
//   async (t, { root, tenk }) => {
//     const contractDelta = await BalanceDelta.create(tenk, t);
//     // Create temporary keys for access key on linkdrop
//     const senderKey = await createLinkdrop(t, tenk, root);
//     t.log("linkdrop cost", await contractDelta.toHuman());
//     const alice = await root.createAccount("alice");
//     const delta = await BalanceDelta.create(root, t);
//     claim_raw(tenk, alice, senderKey);
//     claim_raw(tenk, root, senderKey);
//     await claim_raw(tenk, alice, senderKey);
//     const tokens = await getTokens(tenk, alice);
//     t.log(tokens);
//     t.is(tokens.length, 1, "should contain at least one token");
//     t.assert(
//       !(await checkKey(senderKey.getPublicKey(), tenk)),
//       "key should not exist"
//     );
//     await delta.isGreater();
//     await contractDelta.isZero();
//     // await deployEmpty(tenk);
//   }
// );

runner.test(
  "Use `claim` to send to non-existent account",
  async (t, { root, tenk }) => {
    // Create temporary keys for access key on linkdrop
    const delta = await BalanceDelta.create(tenk, t);
    const senderKey = await createLinkdrop(t, tenk, root);
    // Bad account invalid accountid
    const alice = await root.getFullAccount("alice--");
    t.log(`Delta ${await delta.toHuman()}`);
    await claim_raw(tenk, alice, senderKey);
    t.assert(
      await checkKey(senderKey.getPublicKey(), tenk),
      "key should still exist"
    );
  }
);

const GAS_COST_ON_FAILURE = NEAR.parse("560 μN").neg();

runner.test("Call `claim` with invalid key", async (t, { root, tenk }) => {
  // Create temporary keys for access key on linkdrop
  // const senderKey = await createLinkdrop(t, tenk, root);
  // Bad account invalid accountid
  // const alice = await root.createAccount("alice");
  const senderKey = await root.getKey();
  const res = await paidFailureGas(t, tenk, async () => {
    try {
      await claim_raw(tenk, root, senderKey);
    } catch {}
  });

  // TODO: add back after fix in api -js is released
  // t.assert(res.failed, `${root.accountId} claiming from ${tenk.accountId}`);
});

runner.test(
  "Spam `claim` to send to non-existent account",
  async (t, { root, tenk }) => {
    // Create temporary keys for access key on linkdrop
    const senderKey = await createLinkdrop(t, tenk, root);
    // Bad account invalid accountid
    const alice = await root.getFullAccount("alice--");
    const delta = await BalanceDelta.create(tenk, t);

    await repeat(5, () => claim_raw(tenk, alice, senderKey));
    debugger;
    t.log(`Delta ${await delta.toHuman()}`);
    t.assert(
      await checkKey(senderKey.getPublicKey(), tenk),
      "key should still exist"
    );
  }
);

runner.test(
  "Use `create_account_and_claim` with existent account",
  async (t, { root, tenk }) => {
    // Create temporary keys for access key on linkdrop
    const senderKey = await createLinkdrop(t, tenk, root);
    // Bad account invalid accountid
    const alice = root;
    const [delta, res] = await getDelta(t, tenk, async () =>
      tenk.call_raw(
        tenk,
        "create_account_and_claim",
        {
          new_account_id: alice,
          new_public_key: senderKey.getPublicKey().toString(),
        },
        {
          signWithKey: senderKey,
          gas: tGas("200"),
        }
      )
    );
    await delta.isLessOrEqual(NEAR.parse("1.02 N"));
    t.assert(res.succeeded);
    ///  Currentyl failed linkdrop claims cause the contract to lose funds to gas.
    t.assert(
      !(await checkKey(senderKey.getPublicKey(), tenk)),
      "key should not exist"
    );

    // await deployEmpty(tenk);
  }
);

function paidFailureGas<T>(t, tenk, fn: () => Promise<T>): Promise<T> {
  return hasDelta<T>(t, tenk, GAS_COST_ON_FAILURE, false, fn);
}