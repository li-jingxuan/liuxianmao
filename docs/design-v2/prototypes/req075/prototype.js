const tablist = document.querySelector('.layer-tabs');
const tabs = [...tablist.querySelectorAll('[role="tab"]')];

function selectTab(selected) {
  for (const tab of tabs) {
    const active = tab === selected;
    const panel = document.getElementById(tab.getAttribute('aria-controls'));

    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
}

tablist.addEventListener('keydown', (event) => {
  const currentIndex = tabs.indexOf(event.target);
  if (currentIndex < 0) return;

  let nextIndex;
  switch (event.key) {
    case 'ArrowUp':
      nextIndex = (currentIndex + tabs.length - 1) % tabs.length;
      break;
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % tabs.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  selectTab(tabs[nextIndex]);
  tabs[nextIndex].focus();
});
