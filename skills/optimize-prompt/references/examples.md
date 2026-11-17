# Before and After

Four rewrites. Each shows the original, the result, and what changed and why. Token figures are the bundled script's estimates (four characters per token), rounded.

## 1. Bloated System Prompt

Before (about 200 tokens):

```text
Hello! You are a helpful, friendly, and knowledgeable AI assistant. I would like you to please act as a customer support agent for our company, Northwind Outfitters. It is VERY IMPORTANT that you are always polite and professional at all times. Please make sure that you always answer the customer's questions in a way that is accurate and helpful. In order to help customers, you should use the order lookup tool. You MUST NEVER, under any circumstances, promise a refund to a customer!!! Refunds are not something you are able to promise. Also, please remember to keep your answers short and concise and to the point, and do not write long answers. If you do not know the answer to something, you should not make something up. As mentioned above, always be polite. Remember: NEVER promise refunds. Thank you!
```

After (about 140 tokens):

```text
You handle customer support chat for Northwind Outfitters, an outdoor clothing retailer. Customers mostly ask about order status, sizing, and returns.

Look up orders with the order lookup tool before answering anything about a specific order.

Do not promise a refund. Refunds are approved by the returns team after inspection, so tell the customer you are passing the request on and that they will hear back within two business days.

Reply in one to three sentences. If you do not have the information, say so and offer to connect the customer to a person.
```

What changed:

- Removed the greeting, sign-off, generic role adjectives, and instructions the model follows unprompted (be accurate, be polite).
- The refund rule appeared three times with capitals; it now appears once with its reason and with what to do instead, which the original never said.
- "Short and concise and to the point" became a number.
- Added the situation (what the company sells, what customers ask). This is new text and worth its tokens.

## 2. Over-Compressed Prompt

The fix here makes the prompt longer.

Before (about 20 tokens):

```text
Summarize PR. Bullets. No fluff. Flag risky stuff. Max brevity!! Skip obvious.
```

After (about 110 tokens):

```text
Summarize this pull request for the engineer who will review it. They know the codebase but have not seen this change.

Return up to five bullets, each one sentence: what changed and why. Leave out renames, formatting, and import changes.

After the bullets, add a "Risks" line listing anything that touches authentication, database migrations, or public API signatures, with the file path. Write "Risks: none" if there are none.
```

What changed:

- "Risky stuff", "fluff", and "obvious" left the reader to guess. Each is now defined.
- The audience is stated, which sets the level of detail.
- The output has a fixed shape, so replies stop varying in length.
- The cost is 90 input tokens. The saving is shorter, consistent output and no re-asking.

## 3. Verbose Data

Before (about 115 tokens for three records, growing with every record):

```text
[
    {
        "product_name": "Trail Jacket",
        "product_sku": "TJ-100",
        "units_in_stock": 14,
        "warehouse_location": "Reno"
    },
    {
        "product_name": "Summit Boots",
        "product_sku": "SB-220",
        "units_in_stock": 0,
        "warehouse_location": "Reno"
    },
    {
        "product_name": "Ridge Gloves",
        "product_sku": "RG-310",
        "units_in_stock": 52,
        "warehouse_location": "Tulsa"
    }
]
```

After (about 30 tokens):

```text
name,sku,stock,warehouse
Trail Jacket,TJ-100,14,Reno
Summit Boots,SB-220,0,Reno
Ridge Gloves,RG-310,52,Tulsa
```

What changed:

- Field names are stated once in a header row and shortened.
- Indentation, braces, and quotes are gone.
- Nothing the task needs was removed. If the task never uses `warehouse`, drop that column too.

## 4. Thin Agent Brief

Before (about 15 tokens):

```text
Look into why the export tests are failing and fix it.
```

After (about 175 tokens):

```text
Three tests in tests/export/test_csv.py started failing on the main branch after commit 4e1b2aa, which changed date handling in src/export/formatters.py. They pass on the commit before it. The failures are all assertion errors comparing timestamp strings.

Find the cause and fix it in the formatter, not in the tests: the tests encode the format our customers' import scripts expect (ISO 8601 with a "Z" suffix), so that format must not change.

I have already ruled out the test fixtures; they are unchanged. Do not modify anything under src/export/legacy/.

Report back with the cause in one or two sentences, the files you changed, and the output of the test run. Say plainly if any test still fails.
```

What changed:

- The recipient starts with no context, so the brief now carries what is known: which tests, since when, and the likely area.
- It states the constraint that separates a real fix from a wrong one (do not edit the tests) and why.
- It says what is ruled out, what is out of bounds, and what to send back.
- About twelve times the tokens, spent once, in place of an agent that rediscovers all of this or "fixes" the tests.
