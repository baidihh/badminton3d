import { CHARACTERS, getCharacter } from './characters.js';

export function mountCharacterPicker(container, { label = '上场角色', onSelect, value = 'athlete' }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'characterPick';
  const title = document.createElement('span'); title.textContent = label;
  const select = document.createElement('select'); select.setAttribute('aria-label', label);
  for (const c of CHARACTERS) {
    const option = document.createElement('option'); option.value = c.id; option.textContent = c.name; select.append(option);
  }
  select.value = getCharacter(value).id;
  select.addEventListener('change', () => onSelect(select.value));
  wrapper.append(title, select); container.append(wrapper);
  return { setValue(id) { select.value = getCharacter(id).id; }, setDisabled(disabled) { select.disabled = disabled; } };
}
