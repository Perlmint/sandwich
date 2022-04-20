const ITEM = Symbol('item');
const EMPTY = Symbol('empty');
const STRIKE = Symbol('strike');

export default {
    productions: [
        {
            symbol: ITEM,
            rhs: [ITEM, ITEM]
        },
        {
            symbol: STRIKE,
            rhs: []
        }
    ],
    operators: [

    ],
    lexer: {
        rules: [{
            regexp: /\\~/,
            token: 'ESCAPED'
        }]
    }
}