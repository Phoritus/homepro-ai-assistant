# Demo product and checkout pages

The links the assistant sends open demo pages. A product page shows the SKU, Thai and English names, price, room size and stock. The checkout page confirms that no payment is taken and no order is created.

## Sub-features

- `page-product` renders the fixture facts for a known SKU.
- `page-product-unknown` returns 404 for an unknown SKU.
- `page-checkout` shows the item and the no-payment notice for an in-stock SKU.
- `page-checkout-oos` refuses an out-of-stock SKU and lists the available ones.

## How to get to it (user POV)

- Press `View HP-xx` or `Demo checkout` under an assistant reply (Web) or in the LINE buttons.

## Driving it with verify.mjs

Preconditions:

- Baseline instance.

- **Product.** Run `verify.mjs get demo/products/HP-F01`. The status is 200, and the text has `HP-F01 12-inch desk fan`, `พัดลมตั้งโต๊ะ 12 นิ้ว`, `฿890`, `small room` and `3 in stock`.
- **Unknown product.** Run `verify.mjs get demo/products/HP-Z99`. The status is 404.
- **Checkout.** Run `verify.mjs get "demo/checkout?sku=HP-F01"`. The text has `No payment is taken and no order is created`.
- **Out-of-stock checkout.** Run `verify.mjs get "demo/checkout?sku=HP-F03"`. The text has `Not available` and lists `HP-F01, HP-F02`.

## Gotchas

- Pass paths without a leading `/`, because Git Bash rewrites `/demo/...` into a Windows path.
- Quote paths containing `?`.
