var _ = require('lodash'),
    hash = require('es-hash'),
    css = require('css');


/**
 * Build prefix
 * @param rule
 * @returns {string}
 */
function getPrefix(rule) {

    var prefixes = [];


    if (rule.parent) {
        var parentPrefix = getPrefix(rule.parent);

        if (parentPrefix) {
            prefixes.push(parentPrefix);
        }
    }

    if (rule.type !== 'rule') {
        prefixes.push(rule.type);
    }

    if (rule.hasOwnProperty(rule.type) && _.isString(rule[rule.type])) {
        prefixes.push(rule[rule.type]);
    }

    var result = prefixes.join('-');

    if (rule.type === 'rule') {
        result += ' '
    }

    return result;
}

/**
 * Generate function that returns declarations for selector which are not in the compare stylesheet
 * The function returns all declarations for the passed in key.
 * Only the declarations where property name and value are equal will be returned
 *
 * @param compare
 * @returns {Function}
 */
function getDeclarationDiffFunction(compare) {
    return function(key,declarations) {
        if (!compare.hasOwnProperty(key)) {
            return declarations;
        }

        // return all declarations which are not inside compare
        return _.chain(declarations)
            .filter(function(declaration){
                return !compare[key].hasOwnProperty(declaration.property) ||
                    compare[key][declaration.property] !==  declaration.value;
            }).value();
    }
}

/**
 * Creates function to compare complete rule declaration with `compareFunc`
 * The returned function returns an array with all selectors for this rule which have remaining style
 * declarations to keep in the resulting css. These selectors are grouped by the declarations they should keep.
 * This functionality is needed to split up rules with multiple selectors in multiple rules if applicable
 *
 * @example
 *
 * // stylesheet a
 * html,
 * body,
 * div {
 *    margin: 0,
 *    padding: 0
 * }
 *
 * // stylesheet b
 * html {
 *    padding: 0
 * }
 *
 * // result
 * [{selectors: ['body','div'], declarations: {margin:0, padding:0}},{ selectors: ['html'], declarations: {margin:0} }]
 *
 * @param compareFunc
 * @returns {Function}
 */
function getGroupedDeclarationDiffFunction(compareFunc) {

    return function (rule) {
        // get prefix
        var prefix = getPrefix(rule);
        return _.chain(rule.selectors)
            // compare each selector and create a hash for the declaration object
            .reduce(function(result,selector){
                var declarations = compareFunc(prefix+selector,rule.declarations);
                result.push({
                    selector: selector,
                    declarations: declarations,
                    hash: hash(_.clone(declarations))
                });
                return result;

            // strip of selectors with no remaining declarations
            },[]).filter(function(entry) {
                return !!entry.declarations.length;

            // group by declaration hash
            }).groupBy(function(entry){
                return entry.hash;

            // pack everything together
            }).reduce(function(result,group) {
                result.push({
                    declarations: _.first(group).declarations,
                    selectors: _.reduce(group,function(result,entry){
                        result.push(entry.selector);
                        return result;
                    },[])
                });
                return result;
            },[]).value();
    }
}


function buildCompare(rules) {
    return _.chain(rules)
        .filter(function (rule) {
            return rule.type && rule.type === 'rule';
        })
        .reduce(function(result, rule) {
            var prefix = getPrefix(rule);
            var declarations = _.chain(rule.declarations)
                .filter(function(declaration) {
                    return declaration.type === 'declaration';
                })
                .reduce(function(result, declaration) {
                    result[declaration.property] = declaration.value;
                    return result;
                },{})
                .value();

            _.forEach(rule.selectors,function(selector){
                result[prefix+selector] = _.assign(result[prefix+selector] || {}, declarations);;
            });

            return result;
        },{}).value();
}


/**
 * compare multiple stylesheet strings and generate diff.
 * Diff consists of all css rules in first stylesheet which do not exist in any other stylesheet
 */
function cssdiff() {

    var args = Array.prototype.slice.call(arguments);
        mainCss = args.shift();

    // return main css if there is nothing to compare with
    if (!args.length) {
        return mainCss;
    }

    var main = css.parse(mainCss);
    var compare = css.parse(args.shift());


    var compareSelectors = buildCompare(compare.stylesheet.rules);




    var compareSelectorKeys = _.keys(compareSelectors);
    var getGroupedDiffDeclarations = getGroupedDeclarationDiffFunction(getDeclarationDiffFunction(compareSelectors));

    main.stylesheet.rules = _.chain(main.stylesheet.rules)
        .reduce(function (result, rule) {
            // intersect with empty array when there is no selector e.g. for rule.type === 'comment'

            var prefix = getPrefix(rule);
            var selectors = _.map(rule.selectors || [],function(selector){
                return prefix + selector;
            });
            var intersection = _.intersection(compareSelectorKeys, selectors);

            // no intersection between main stylesheet and compare stylesheet
            if (rule.type !== 'rule' || !intersection.length) {
                result.push(rule);

            // intersections found
            } else {
                var groupedDiffDeclarations = getGroupedDiffDeclarations(rule);

                _.forEach(groupedDiffDeclarations,function(group){
                    var clone = _.cloneDeep(rule);
                    clone.selectors = group.selectors;
                    clone.declarations = group.declarations;
                    result.push(clone)
                });
            }

            return result;
        },[])
        .uniq()
        .value();


    return css.stringify(main);
}


module.exports = cssdiff;