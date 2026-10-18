import type { NavigationForm, NavigationFormKind, SearchForm } from '../adaptive/navigation';

const SEARCH: Record<NavigationFormKind, Pick<SearchForm, 'form' | 'place'>> = {
  bar: { form: 'button', place: 'bar' },
  rail: { form: 'item', place: 'rail' },
  sidebar: { form: 'field', place: 'sidebar' },
};

/**
 * The model's answer held to one form, for a host that knows its layout or opens the sidebar over the content: the
 * destinations stay the same, the search takes the form's own shape and the toggle follows the form.
 */
export function fixedNavigationForm(nav: NavigationForm, form: NavigationFormKind): NavigationForm {
  if (nav.form === form) return nav;
  return {
    ...nav,
    form,
    edge: form === 'bar' ? 'bottom' : 'leading',
    secondaryVisible: form === 'sidebar',
    search: nav.search ? { ...nav.search, ...SEARCH[form] } : null,
    expandable: form === 'rail' ? nav.expandable : null,
    collapsible: form === 'sidebar',
  };
}
