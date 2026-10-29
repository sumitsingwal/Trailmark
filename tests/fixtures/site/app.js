// Adds list rows so recorded steps can target elements that only exist mid-flow.
let count = 0
document.querySelector('[data-testid="add-line"]').addEventListener('click', () => {
  count += 1
  const li = document.createElement('li')
  li.className = 'line'
  li.innerHTML = `<span>Line ${count}</span> <button type="button" class="remove">Remove</button>`
  document.getElementById('lines').append(li)
})

// Open shadow root, so locator building has a boundary to cope with.
const host = document.getElementById('widget-host')
const shadow = host.attachShadow({ mode: 'open' })
shadow.innerHTML =
  '<label for="coupon">Coupon</label>' +
  '<input id="coupon" name="coupon" type="text" />' +
  '<button type="button" id="apply-coupon">Apply</button>'
