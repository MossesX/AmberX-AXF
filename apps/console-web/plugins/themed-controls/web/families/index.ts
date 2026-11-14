/** Every family the host knows: element swaps (inputs) and global families (dialogs, tooltips, scrollbars). */
import type { ElementFamily, GlobalFamily } from '../host';
import { checkboxFamily, numberFamily, radioFamily, rangeFamily } from './basic';
import { datetimeFamily } from './datetime';
import './time';

export const ELEMENT_FAMILIES: ElementFamily[] = [checkboxFamily, radioFamily, rangeFamily, numberFamily, datetimeFamily];
export const GLOBAL_FAMILIES: GlobalFamily[] = [];
