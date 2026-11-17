// Putting the chat on a business's website (src/widget/install.ts): a
// website and its www twin, and whether a page carries the chat's code.

import assert from "node:assert/strict";
import test from "node:test";
import { inspectPage, originVariants } from "../../src/widget/install.ts";

test("a website and its www twin, https only", () => {
  assert.deepEqual(originVariants("happyfinewholesalers.co.ke"), ["https://happyfinewholesalers.co.ke", "https://www.happyfinewholesalers.co.ke"]);
  assert.deepEqual(originVariants("https://www.coralcove.co.ke/rooms?x=1"), ["https://www.coralcove.co.ke", "https://coralcove.co.ke"]);
  assert.deepEqual(originVariants("HTTPS://Shop.Example.com"), ["https://shop.example.com", "https://www.shop.example.com"]);
  for (const bad of ["", "not a website", "http://coralcove.co.ke", "https://coralcove.co.ke:8443", "https://localhost", "https://10.0.0.5", "ftp://coralcove.co.ke"]) {
    assert.equal(originVariants(bad), null, bad);
  }
});

test("whether a page carries the chat's code for this business", () => {
  const business = { id: "coral", publicKey: "pk_coral_abc" };
  assert.deepEqual(inspectPage('<script src="https://bilamatata.com/zaina.js" data-business="coral" async></script>', business), { installed: "yes", tagManager: false });
  assert.equal(inspectPage("<script async data-business='coral' src='/zaina.js?v=2'></script>", business).installed, "yes");
  assert.equal(inspectPage('<script src="https://bilamatata.com/widget.js" data-key="pk_coral_abc"></script>', business).installed, "yes", "the older code still counts");
  assert.equal(inspectPage('<script src="https://bilamatata.com/zaina.js" data-business="palm"></script>', business).installed, "other_business");
  assert.equal(inspectPage('<script src="/js/zaina.jsx"></script><p>coral</p>', business).installed, "no");
  assert.deepEqual(inspectPage('<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>', business), { installed: "no", tagManager: true });
});
