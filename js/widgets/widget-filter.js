/*! Widget: filter - updated 2/15/2016 (v2.25.4) *//*
 * Requires tablesorter v2.8+ and jQuery 1.7+
 * by Rob Garrison
 */
;( function ( $ ) {
	'use strict';
	var tsf, tsfRegex,
		ts = $.tablesorter || {},
		tscss = ts.css,
		tskeyCodes = ts.keyCodes;

	$.extend( tscss, {
		filterRow      : 'tablesorter-filter-row',
		filter         : 'tablesorter-filter',
		filterDisabled : 'disabled',
		filterRowHide  : 'hideme'
	});

	$.extend( tskeyCodes, {
		backSpace : 8,
		escape : 27,
		space : 32,
		left : 37,
		down : 40
	});

	ts.addWidget({
		id: 'filter',
		priority: 50,
		options : {
			filter_childRows     : false, // if true, filter includes child row content in the search
			filter_childByColumn : false, // ( filter_childRows must be true ) if true = search child rows by column; false = search all child row text grouped
			filter_childWithSibs : true,  // if true, include matching child row siblings
			filter_columnFilters : true,  // if true, a filter will be added to the top of each table column
			filter_columnAnyMatch: true,  // if true, allows using '#:{query}' in AnyMatch searches ( column:query )
			filter_cellFilter    : '',    // css class name added to the filter cell ( string or array )
			filter_cssFilter     : '',    // css class name added to the filter row & each input in the row ( tablesorter-filter is ALWAYS added )
			filter_defaultFilter : {},    // add a default column filter type '~{query}' to make fuzzy searches default; '{q1} AND {q2}' to make all searches use a logical AND.
			filter_excludeFilter : {},    // filters to exclude, per column
			filter_external      : '',    // jQuery selector string ( or jQuery object ) of external filters
			filter_filteredRow   : 'filtered', // class added to filtered rows; needed by pager plugin
			filter_formatter     : null,  // add custom filter elements to the filter row
			filter_functions     : null,  // add custom filter functions using this option
			filter_hideEmpty     : true,  // hide filter row when table is empty
			filter_hideFilters   : false, // collapse filter row when mouse leaves the area
			filter_ignoreCase    : true,  // if true, make all searches case-insensitive
			filter_liveSearch    : true,  // if true, search column content while the user types ( with a delay )
			filter_onlyAvail     : 'filter-onlyAvail', // a header with a select dropdown & this class name will only show available ( visible ) options within the drop down
			filter_placeholder   : { search : '', select : '' }, // default placeholder text ( overridden by any header 'data-placeholder' setting )
			filter_reset         : null,  // jQuery selector string of an element used to reset the filters
			filter_resetOnEsc    : true,  // Reset filter input when the user presses escape - normalized across browsers
			filter_saveFilters   : false, // Use the $.tablesorter.storage utility to save the most recent filters
			filter_searchDelay   : 300,   // typing delay in milliseconds before starting a search
			filter_searchFiltered: true,  // allow searching through already filtered rows in special circumstances; will speed up searching in large tables if true
			filter_selectSource  : null,  // include a function to return an array of values to be added to the column filter select
			filter_startsWith    : false, // if true, filter start from the beginning of the cell contents
			filter_useParsedData : false, // filter all data using parsed content
			filter_serversideFiltering : false, // if true, must perform server-side filtering b/c client-side filtering is disabled, but the ui and events will still be used.
			filter_defaultAttrib : 'data-value', // data attribute in the header cell that contains the default filter value
			filter_selectSourceSeparator : '|' // filter_selectSource array text left of the separator is added to the option value, right into the option text
		},
		format: function( table, c, wo ) {
			if ( !c.$table.hasClass( 'hasFilters' ) ) {
				tsf.init( table, c, wo );
			}
		},
		remove: function( table, c, wo, refreshing ) {
			var tbodyIndex, $tbody,
				$table = c.$table,
				$tbodies = c.$tbodies,
				events = 'addRows updateCell update updateRows updateComplete appendCache filterReset filterEnd search '
					.split( ' ' ).join( c.namespace + 'filter ' );
			$table
				.removeClass( 'hasFilters' )
				// add filter namespace to all BUT search
				.unbind( events.replace( ts.regex.spaces, ' ' ) )
				// remove the filter row even if refreshing, because the column might have been moved
				.find( '.' + tscss.filterRow ).remove();
			if ( refreshing ) { return; }
			for ( tbodyIndex = 0; tbodyIndex < $tbodies.length; tbodyIndex++ ) {
				$tbody = ts.processTbody( table, $tbodies.eq( tbodyIndex ), true ); // remove tbody
				$tbody.children().removeClass( wo.filter_filteredRow ).show();
				ts.processTbody( table, $tbody, false ); // restore tbody
			}
			if ( wo.filter_reset ) {
				$( document ).undelegate( wo.filter_reset, 'click' + c.namespace + 'filter' );
			}
		}
	});

	tsf = ts.filter = {

		// regex used in filter 'check' functions - not for general use and not documented
		regex: {
			regex     : /^\/((?:\\\/|[^\/])+)\/([mig]{0,3})?$/, // regex to test for regex
			child     : /tablesorter-childRow/, // child row class name; this gets updated in the script
			filtered  : /filtered/, // filtered (hidden) row class name; updated in the script
			type      : /undefined|number/, // check type
			exact     : /(^[\"\'=]+)|([\"\'=]+$)/g, // exact match (allow '==')
			operators : /[<>=]/g, // replace operators
			query     : '(q|query)', // replace filter queries
			wild01    : /\?/g, // wild card match 0 or 1
			wild0More : /\*/g, // wild care match 0 or more
			quote     : /\"/g,
			isNeg1    : /(>=?\s*-\d)/,
			isNeg2    : /(<=?\s*\d)/
		},
		// function( c, data ) { }
		// c = table.config
		// data.$row = jQuery object of the row currently being processed
		// data.$cells = jQuery object of all cells within the current row
		// data.filters = array of filters for all columns ( some may be undefined )
		// data.filter = filter for the current column
		// data.iFilter = same as data.filter, except lowercase ( if wo.filter_ignoreCase is true )
		// data.exact = table cell text ( or parsed data if column parser enabled; may be a number & not a string )
		// data.iExact = same as data.exact, except lowercase ( if wo.filter_ignoreCase is true; may be a number & not a string )
		// data.cache = table cell text from cache, so it has been parsed ( & in all lower case if c.ignoreCase is true )
		// data.cacheArray = An array of parsed content from each table cell in the row being processed
		// data.index = column index; table = table element ( DOM )
		// data.parsed = array ( by column ) of boolean values ( from filter_useParsedData or 'filter-parsed' class )
		types: {
			or : function( c, data, vars ) {
				// look for "|", but not if it is inside of a regular expression
				if ( ( tsfRegex.orTest.test( data.iFilter ) || tsfRegex.orSplit.test( data.filter ) ) &&
					// this test for regex has potential to slow down the overall search
					!tsfRegex.regex.test( data.filter ) ) {
					var indx, filterMatched, query, regex,
						// duplicate data but split filter
						data2 = $.extend( {}, data ),
						filter = data.filter.split( tsfRegex.orSplit ),
						iFilter = data.iFilter.split( tsfRegex.orSplit ),
						len = filter.length;
					for ( indx = 0; indx < len; indx++ ) {
						data2.nestedFilters = true;
						data2.filter = '' + ( tsf.parseFilter( c, filter[ indx ], data ) || '' );
						data2.iFilter = '' + ( tsf.parseFilter( c, iFilter[ indx ], data ) || '' );
						query = '(' + ( tsf.parseFilter( c, data2.filter, data ) || '' ) + ')';
						try {
							// use try/catch, because query may not be a valid regex if "|" is contained within a partial regex search,
							// e.g "/(Alex|Aar" -> Uncaught SyntaxError: Invalid regular expression: /(/(Alex)/: Unterminated group
							regex = new RegExp( data.isMatch ? query : '^' + query + '$', c.widgetOptions.filter_ignoreCase ? 'i' : '' );
							// filterMatched = data2.filter === '' && indx > 0 ? true
							// look for an exact match with the 'or' unless the 'filter-match' class is found
							filterMatched = regex.test( data2.exact ) || tsf.processTypes( c, data2, vars );
							if ( filterMatched ) {
								return filterMatched;
							}
						} catch ( error ) {
							return null;
						}
					}
					// may be null from processing types
					return filterMatched || false;
				}
				return null;
			},
			// Look for an AND or && operator ( logical and )
			and : function( c, data, vars ) {
				if ( tsfRegex.andTest.test( data.filter ) ) {
					var indx, filterMatched, result, query, regex,
						// duplicate data but split filter
						data2 = $.extend( {}, data ),
						filter = data.filter.split( tsfRegex.andSplit ),
						iFilter = data.iFilter.split( tsfRegex.andSplit ),
						len = filter.length;
					for ( indx = 0; indx < len; indx++ ) {
						data2.nestedFilters = true;
						data2.filter = '' + ( tsf.parseFilter( c, filter[ indx ], data ) || '' );
						data2.iFilter = '' + ( tsf.parseFilter( c, iFilter[ indx ], data ) || '' );
						query = ( '(' + ( tsf.parseFilter( c, data2.filter, data ) || '' ) + ')' )
							// replace wild cards since /(a*)/i will match anything
							.replace( tsfRegex.wild01, '\\S{1}' ).replace( tsfRegex.wild0More, '\\S*' );
						try {
							// use try/catch just in case RegExp is invalid
							regex = new RegExp( data.isMatch ? query : '^' + query + '$', c.widgetOptions.filter_ignoreCase ? 'i' : '' );
							// look for an exact match with the 'and' unless the 'filter-match' class is found
							result = ( regex.test( data2.exact ) || tsf.processTypes( c, data2, vars ) );
							if ( indx === 0 ) {
								filterMatched = result;
							} else {
								filterMatched = filterMatched && result;
							}
						} catch ( error ) {
							return null;
						}
					}
					// may be null from processing types
					return filterMatched || false;
				}
				return null;
			},
			// Look for regex
			regex: function( c, data ) {
				if ( tsfRegex.regex.test( data.filter ) ) {
					var matches,
						// cache regex per column for optimal speed
						regex = data.filter_regexCache[ data.index ] || tsfRegex.regex.exec( data.filter ),
						isRegex = regex instanceof RegExp;
					try {
						if ( !isRegex ) {
							// force case insensitive search if ignoreCase option set?
							// if ( c.ignoreCase && !regex[2] ) { regex[2] = 'i'; }
							data.filter_regexCache[ data.index ] = regex = new RegExp( regex[1], regex[2] );
						}
						matches = regex.test( data.exact );
					} catch ( error ) {
						matches = false;
					}
					return matches;
				}
				return null;
			},
			// Look for operators >, >=, < or <=
			operators: function( c, data ) {
				// ignore empty strings... because '' < 10 is true
				if ( tsfRegex.operTest.test( data.iFilter ) && data.iExact !== '' ) {
					var cachedValue, result, txt,
						table = c.table,
						parsed = data.parsed[ data.index ],
						query = ts.formatFloat( data.iFilter.replace( tsfRegex.operators, '' ), table ),
						parser = c.parsers[ data.index ] || {},
						savedSearch = query;
					// parse filter value in case we're comparing numbers ( dates )
					if ( parsed || parser.type === 'numeric' ) {
						txt = $.trim( '' + data.iFilter.replace( tsfRegex.operators, '' ) );
						result = tsf.parseFilter( c, txt, data, true );
						query = ( typeof result === 'number' && result !== '' && !isNaN( result ) ) ? result : query;
					}
					// iExact may be numeric - see issue #149;
					// check if cached is defined, because sometimes j goes out of range? ( numeric columns )
					if ( ( parsed || parser.type === 'numeric' ) && !isNaN( query ) &&
						typeof data.cache !== 'undefined' ) {
						cachedValue = data.cache;
					} else {
						txt = isNaN( data.iExact ) ? data.iExact.replace( ts.regex.nondigit, '' ) : data.iExact;
						cachedValue = ts.formatFloat( txt, table );
					}
					if ( tsfRegex.gtTest.test( data.iFilter ) ) {
						result = tsfRegex.gteTest.test( data.iFilter ) ? cachedValue >= query : cachedValue > query;
					} else if ( tsfRegex.ltTest.test( data.iFilter ) ) {
						result = tsfRegex.lteTest.test( data.iFilter ) ? cachedValue <= query : cachedValue < query;
					}
					// keep showing all rows if nothing follows the operator
					if ( !result && savedSearch === '' ) {
						result = true;
					}
					return result;
				}
				return null;
			},
			// Look for a not match
			notMatch: function( c, data ) {
				if ( tsfRegex.notTest.test( data.iFilter ) ) {
					var indx,
						txt = data.iFilter.replace( '!', '' ),
						filter = tsf.parseFilter( c, txt, data ) || '';
					if ( tsfRegex.exact.test( filter ) ) {
						// look for exact not matches - see #628
						filter = filter.replace( tsfRegex.exact, '' );
						return filter === '' ? true : $.trim( filter ) !== data.iExact;
					} else {
						indx = data.iExact.search( $.trim( filter ) );
						return filter === '' ? true : !( c.widgetOptions.filter_startsWith ? indx === 0 : indx >= 0 );
					}
				}
				return null;
			},
			// Look for quotes or equals to get an exact match; ignore type since iExact could be numeric
			exact: function( c, data ) {
				/*jshint eqeqeq:false */
				if ( tsfRegex.exact.test( data.iFilter ) ) {
					var txt = data.iFilter.replace( tsfRegex.exact, '' ),
						filter = tsf.parseFilter( c, txt, data ) || '';
					return data.anyMatch ? $.inArray( filter, data.rowArray ) >= 0 : filter == data.iExact;
				}
				return null;
			},
			// Look for a range ( using ' to ' or ' - ' ) - see issue #166; thanks matzhu!
			range : function( c, data ) {
				if ( tsfRegex.toTest.test( data.iFilter ) ) {
					var result, tmp, range1, range2,
						table = c.table,
						index = data.index,
						parsed = data.parsed[index],
						// make sure the dash is for a range and not indicating a negative number
						query = data.iFilter.split( tsfRegex.toSplit );

					tmp = query[0].replace( ts.regex.nondigit, '' ) || '';
					range1 = ts.formatFloat( tsf.parseFilter( c, tmp, data ), table );
					tmp = query[1].replace( ts.regex.nondigit, '' ) || '';
					range2 = ts.formatFloat( tsf.parseFilter( c, tmp, data ), table );
					// parse filter value in case we're comparing numbers ( dates )
					if ( parsed || c.parsers[ index ].type === 'numeric' ) {
						result = c.parsers[ index ].format( '' + query[0], table, c.$headers.eq( index ), index );
						range1 = ( result !== '' && !isNaN( result ) ) ? result : range1;
						result = c.parsers[ index ].format( '' + query[1], table, c.$headers.eq( index ), index );
						range2 = ( result !== '' && !isNaN( result ) ) ? result : range2;
					}
					if ( ( parsed || c.parsers[ index ].type === 'numeric' ) && !isNaN( range1 ) && !isNaN( range2 ) ) {
						result = data.cache;
					} else {
						tmp = isNaN( data.iExact ) ? data.iExact.replace( ts.regex.nondigit, '' ) : data.iExact;
						result = ts.formatFloat( tmp, table );
					}
					if ( range1 > range2 ) {
						tmp = range1; range1 = range2; range2 = tmp; // swap
					}
					return ( result >= range1 && result <= range2 ) || ( range1 === '' || range2 === '' );
				}
				return null;
			},
			// Look for wild card: ? = single, * = multiple, or | = logical OR
			wild : function( c, data ) {
				if ( tsfRegex.wildOrTest.test( data.iFilter ) ) {
					var query = '' + ( tsf.parseFilter( c, data.iFilter, data ) || '' );
					// look for an exact match with the 'or' unless the 'filter-match' class is found
					if ( !tsfRegex.wildTest.test( query ) && data.nestedFilters ) {
						query = data.isMatch ? query : '^(' + query + ')$';
					}
					// parsing the filter may not work properly when using wildcards =/
					try {
						return new RegExp(
							query.replace( tsfRegex.wild01, '\\S{1}' ).replace( tsfRegex.wild0More, '\\S*' ),
							c.widgetOptions.filter_ignoreCase ? 'i' : ''
						)
						.test( data.exact );
					} catch ( error ) {
						return null;
					}
				}
				return null;
			},
			// fuzzy text search; modified from https://github.com/mattyork/fuzzy ( MIT license )
			fuzzy: function( c, data ) {
				if ( tsfRegex.fuzzyTest.test( data.iFilter ) ) {
					var indx,
						patternIndx = 0,
						len = data.iExact.length,
						txt = data.iFilter.slice( 1 ),
						pattern = tsf.parseFilter( c, txt, data ) || '';
					for ( indx = 0; indx < len; indx++ ) {
						if ( data.iExact[ indx ] === pattern[ patternIndx ] ) {
							patternIndx += 1;
						}
					}
					return patternIndx === pattern.length;
				}
				return null;
			}
		},
		init: function( table, c, wo ) {
			// filter language options
			ts.language = $.extend( true, {}, {
				to  : 'to',
				or  : 'or',
				and : 'and'
			}, ts.language );

			var options, string, txt, $header, column, filters, val, fxn, noSelect;
			c.$table.addClass( 'hasFilters' );
			c.lastSearch = [];

			// define timers so using clearTimeout won't cause an undefined error
			wo.filter_searchTimer = null;
			wo.filter_initTimer = null;
			wo.filter_formatterCount = 0;
			wo.filter_formatterInit = [];
			wo.filter_anyColumnSelector = '[data-column="all"],[data-column="any"]';
			wo.filter_multipleColumnSelector = '[data-column*="-"],[data-column*=","]';

			val = '\\{' + tsfRegex.query + '\\}';
			$.extend( tsfRegex, {
				child : new RegExp( c.cssChildRow ),
				filtered : new RegExp( wo.filter_filteredRow ),
				alreadyFiltered : new RegExp( '(\\s+(' + ts.language.or + '|-|' + ts.language.to + ')\\s+)', 'i' ),
				toTest : new RegExp( '\\s+(-|' + ts.language.to + ')\\s+', 'i' ),
				toSplit : new RegExp( '(?:\\s+(?:-|' + ts.language.to + ')\\s+)', 'gi' ),
				andTest : new RegExp( '\\s+(' + ts.language.and + '|&&)\\s+', 'i' ),
				andSplit : new RegExp( '(?:\\s+(?:' + ts.language.and + '|&&)\\s+)', 'gi' ),
				orTest : new RegExp( '(\\||\\s+' + ts.language.or + '\\s+)', 'i' ),
				orSplit : new RegExp( '(?:\\s+(?:' + ts.language.or + ')\\s+|\\|)', 'gi' ),
				iQuery : new RegExp( val, 'i' ),
				igQuery : new RegExp( val, 'ig' ),
				operTest : /^[<>]=?/,
				gtTest  : />/,
				gteTest : />=/,
				ltTest  : /</,
				lteTest : /<=/,
				notTest : /^\!/,
				wildOrTest : /[\?\*\|]/,
				wildTest : /\?\*/,
				fuzzyTest : /^~/,
				exactTest : /[=\"\|!]/
			});

			// don't build filter row if columnFilters is false or all columns are set to 'filter-false'
			// see issue #156
			val = c.$headers.filter( '.filter-false, .parser-false' ).length;
			if ( wo.filter_columnFilters !== false && val !== c.$headers.length ) {
				// build filter row
				tsf.buildRow( table, c, wo );
			}

			txt = 'addRows updateCell update updateRows updateComplete appendCache filterReset filterEnd search '
				.split( ' ' ).join( c.namespace + 'filter ' );
			c.$table.bind( txt, function( event, filter ) {
				val = wo.filter_hideEmpty &&
					$.isEmptyObject( c.cache ) &&
					!( c.delayInit && event.type === 'appendCache' );
				// hide filter row using the 'filtered' class name
				c.$table.find( '.' + tscss.filterRow ).toggleClass( wo.filter_filteredRow, val ); // fixes #450
				if ( !/(search|filter)/.test( event.type ) ) {
					event.stopPropagation();
					tsf.buildDefault( table, true );
				}
				if ( event.type === 'filterReset' ) {
					c.$table.find( '.' + tscss.filter ).add( wo.filter_$externalFilters ).val( '' );
					tsf.searching( table, [] );
				} else if ( event.type === 'filterEnd' ) {
					tsf.buildDefault( table, true );
				} else {
					// send false argument to force a new search; otherwise if the filter hasn't changed,
					// it will return
					filter = event.type === 'search' ? filter :
						event.type === 'updateComplete' ? c.$table.data( 'lastSearch' ) : '';
					if ( /(update|add)/.test( event.type ) && event.type !== 'updateComplete' ) {
						// force a new search since content has changed
						c.lastCombinedFilter = null;
						c.lastSearch = [];
					}
					// pass true ( skipFirst ) to prevent the tablesorter.setFilters function from skipping the first
					// input ensures all inputs are updated when a search is triggered on the table
					// $( 'table' ).trigger( 'search', [...] );
					tsf.searching( table, filter, true );
				}
				return false;
			});

			// reset button/link
			if ( wo.filter_reset ) {
				if ( wo.filter_reset instanceof $ ) {
					// reset contains a jQuery object, bind to it
					wo.filter_reset.click( function() {
						c.$table.triggerHandler( 'filterReset' );
					});
				} else if ( $( wo.filter_reset ).length ) {
					// reset is a jQuery selector, use event delegation
					$( document )
						.undelegate( wo.filter_reset, 'click' + c.namespace + 'filter' )
						.delegate( wo.filter_reset, 'click' + c.namespace + 'filter', function() {
							// trigger a reset event, so other functions ( filter_formatter ) know when to reset
							c.$table.triggerHandler( 'filterReset' );
						});
				}
			}
			if ( wo.filter_functions ) {
				for ( column = 0; column < c.columns; column++ ) {
					fxn = ts.getColumnData( table, wo.filter_functions, column );
					if ( fxn ) {
						// remove 'filter-select' from header otherwise the options added here are replaced with
						// all options
						$header = c.$headerIndexed[ column ].removeClass( 'filter-select' );
						// don't build select if 'filter-false' or 'parser-false' set
						noSelect = !( $header.hasClass( 'filter-false' ) || $header.hasClass( 'parser-false' ) );
						options = '';
						if ( fxn === true && noSelect ) {
							tsf.buildSelect( table, column );
						} else if ( typeof fxn === 'object' && noSelect ) {
							// add custom drop down list
							for ( string in fxn ) {
								if ( typeof string === 'string' ) {
									options += options === '' ?
										'<option value="">' +
											( $header.data( 'placeholder' ) ||
												$header.attr( 'data-placeholder' ) ||
												wo.filter_placeholder.select ||
												''
											) +
										'</option>' : '';
									val = string;
									txt = string;
									if ( string.indexOf( wo.filter_selectSourceSeparator ) >= 0 ) {
										val = string.split( wo.filter_selectSourceSeparator );
										txt = val[1];
										val = val[0];
									}
									options += '<option ' +
										( txt === val ? '' : 'data-function-name="' + string + '" ' ) +
										'value="' + val + '">' + txt + '</option>';
								}
							}
							c.$table
								.find( 'thead' )
								.find( 'select.' + tscss.filter + '[data-column="' + column + '"]' )
								.append( options );
							txt = wo.filter_selectSource;
							fxn = typeof txt === 'function' ? true : ts.getColumnData( table, txt, column );
							if ( fxn ) {
								// updating so the extra options are appended
								tsf.buildSelect( c.table, column, '', true, $header.hasClass( wo.filter_onlyAvail ) );
							}
						}
					}
				}
			}
			// not really updating, but if the column has both the 'filter-select' class &
			// filter_functions set to true, it would append the same options twice.
			tsf.buildDefault( table, true );

			tsf.bindSearch( table, c.$table.find( '.' + tscss.filter ), true );
			if ( wo.filter_external ) {
				tsf.bindSearch( table, wo.filter_external );
			}

			if ( wo.filter_hideFilters ) {
				tsf.hideFilters( c );
			}

			// show processing icon
			if ( c.showProcessing ) {
				txt = 'filterStart filterEnd '.split( ' ' ).join( c.namespace + 'filter ' );
				c.$table
					.unbind( txt.replace( ts.regex.spaces, ' ' ) )
					.bind( txt, function( event, columns ) {
					// only add processing to certain columns to all columns
					$header = ( columns ) ?
						c.$table
							.find( '.' + tscss.header )
							.filter( '[data-column]' )
							.filter( function() {
								return columns[ $( this ).data( 'column' ) ] !== '';
							}) : '';
					ts.isProcessing( table, event.type === 'filterStart', columns ? $header : '' );
				});
			}

			// set filtered rows count ( intially unfiltered )
			c.filteredRows = c.totalRows;

			// add default values
			txt = 'tablesorter-initialized pagerBeforeInitialized '.split( ' ' ).join( c.namespace + 'filter ' );
			c.$table
			.unbind( txt.replace( ts.regex.spaces, ' ' ) )
			.bind( txt, function() {
				// redefine 'wo' as it does not update properly inside this callback
				var wo = this.config.widgetOptions;
				filters = tsf.setDefaults( table, c, wo ) || [];
				if ( filters.length ) {
					// prevent delayInit from triggering a cache build if filters are empty
					if ( !( c.delayInit && filters.join( '' ) === '' ) ) {
						ts.setFilters( table, filters, true );
					}
				}
				c.$table.triggerHandler( 'filterFomatterUpdate' );
				// trigger init after setTimeout to prevent multiple filterStart/End/Init triggers
				setTimeout( function() {
					if ( !wo.filter_initialized ) {
						tsf.filterInitComplete( c );
					}
				}, 100 );
			});
			// if filter widget is added after pager has initialized; then set filter init flag
			if ( c.pager && c.pager.initialized && !wo.filter_initialized ) {
				c.$table.triggerHandler( 'filterFomatterUpdate' );
				setTimeout( function() {
					tsf.filterInitComplete( c );
				}, 100 );
			}
		},
		// $cell parameter, but not the config, is passed to the filter_formatters,
		// so we have to work with it instead
		formatterUpdated: function( $cell, column ) {
			// prevent error if $cell is undefined - see #1056
			var wo = $cell && $cell.closest( 'table' )[0].config.widgetOptions;
			if ( wo && !wo.filter_initialized ) {
				// add updates by column since this function
				// may be called numerous times before initialization
				wo.filter_formatterInit[ column ] = 1;
			}
		},
		filterInitComplete: function( c ) {
			var indx, len,
				wo = c.widgetOptions,
				count = 0,
				completed = function() {
					wo.filter_initialized = true;
					c.$table.triggerHandler( 'filterInit', c );
					tsf.findRows( c.table, c.$table.data( 'lastSearch' ) || [] );
				};
			if ( $.isEmptyObject( wo.filter_formatter ) ) {
				completed();
			} else {
				len = wo.filter_formatterInit.length;
				for ( indx = 0; indx < len; indx++ ) {
					if ( wo.filter_formatterInit[ indx ] === 1 ) {
						count++;
					}
				}
				clearTimeout( wo.filter_initTimer );
				if ( !wo.filter_initialized && count === wo.filter_formatterCount ) {
					// filter widget initialized
					completed();
				} else if ( !wo.filter_initialized ) {
					// fall back in case a filter_formatter doesn't call
					// $.tablesorter.filter.formatterUpdated( $cell, column ), and the count is off
					wo.filter_initTimer = setTimeout( function() {
						completed();
					}, 500 );
				}
			}
		},
		// encode or decode filters for storage; see #1026
		processFilters: function( filters, encode ) {
			var indx,
				mode = encode ? encodeURIComponent : decodeURIComponent,
				len = filters.length;
			for ( indx = 0; indx < len; indx++ ) {
				if ( filters[ indx ] ) {
					filters[ indx ] = mode( filters[ indx ] );
				}
			}
			return filters;
		},
		setDefaults: function( table, c, wo ) {
			var isArray, saved, indx, col, $filters,
				// get current ( default ) filters
				filters = ts.getFilters( table ) || [];
			if ( wo.filter_saveFilters && ts.storage ) {
				saved = ts.storage( table, 'tablesorter-filters' ) || [];
				isArray = $.isArray( saved );
				// make sure we're not just getting an empty array
				if ( !( isArray && saved.join( '' ) === '' || !isArray ) ) {
					filters = tsf.processFilters( saved );
				}
			}
			// if no filters saved, then check default settings
			if ( filters.join( '' ) === '' ) {
				// allow adding default setting to external filters
				$filters = c.$headers.add( wo.filter_$externalFilters )
					.filter( '[' + wo.filter_defaultAttrib + ']' );
				for ( indx = 0; indx <= c.columns; indx++ ) {
					// include data-column='all' external filters
					col = indx === c.columns ? 'all' : indx;
					filters[ indx ] = $filters
						.filter( '[data-column="' + col + '"]' )
						.attr( wo.filter_defaultAttrib ) || filters[indx] || '';
				}
			}
			c.$table.data( 'lastSearch', filters );
			return filters;
		},
		parseFilter: function( c, filter, data, parsed ) {
			return parsed || data.parsed[ data.index ] ?
				c.parsers[ data.index ].format( filter, c.table, [], data.index ) :
				filter;
		},
		buildRow: function( table, c, wo ) {
			var $filter, col, column, $header, makeSelect, disabled, name, ffxn, tmp,
				// c.columns defined in computeThIndexes()
				cellFilter = wo.filter_cellFilter,
				columns = c.columns,
				arry = $.isArray( cellFilter ),
				buildFilter = '<tr role="row" class="' + tscss.filterRow + ' ' + c.cssIgnoreRow + '">';
			for ( column = 0; column < columns; column++ ) {
				if ( c.$headerIndexed[ column ].length ) {
					// account for entire column set with colspan. See #1047
					tmp = c.$headerIndexed[ column ] && c.$headerIndexed[ column ][0].colSpan || 0;
					if ( tmp > 1 ) {
						buildFilter += '<td data-column="' + column + '-' + ( column + tmp - 1 ) + '" colspan="' + tmp + '"';
					} else {
						buildFilter += '<td data-column="' + column + '"';
					}
					if ( arry ) {
						buildFilter += ( cellFilter[ column ] ? ' class="' + cellFilter[ column ] + '"' : '' );
					} else {
						buildFilter += ( cellFilter !== '' ? ' class="' + cellFilter + '"' : '' );
					}
					buildFilter += '></td>';
				}
			}
			c.$filters = $( buildFilter += '</tr>' )
				.appendTo( c.$table.children( 'thead' ).eq( 0 ) )
				.children( 'td' );
			// build each filter input
			for ( column = 0; column < columns; column++ ) {
				disabled = false;
				// assuming last cell of a column is the main column
				$header = c.$headerIndexed[ column ];
				if ( $header && $header.length ) {
					// $filter = c.$filters.filter( '[data-column="' + column + '"]' );
					$filter = tsf.getColumnElm( c, c.$filters, column );
					ffxn = ts.getColumnData( table, wo.filter_functions, column );
					makeSelect = ( wo.filter_functions && ffxn && typeof ffxn !== 'function' ) ||
						$header.hasClass( 'filter-select' );
					// get data from jQuery data, metadata, headers option or header class name
					col = ts.getColumnData( table, c.headers, column );
					disabled = ts.getData( $header[0], col, 'filter' ) === 'false' ||
						ts.getData( $header[0], col, 'parser' ) === 'false';

					if ( makeSelect ) {
						buildFilter = $( '<select>' ).appendTo( $filter );
					} else {
						ffxn = ts.getColumnData( table, wo.filter_formatter, column );
						if ( ffxn ) {
							wo.filter_formatterCount++;
							buildFilter = ffxn( $filter, column );
							// no element returned, so lets go find it
							if ( buildFilter && buildFilter.length === 0 ) {
								buildFilter = $filter.children( 'input' );
							}
							// element not in DOM, so lets attach it
							if ( buildFilter && ( buildFilter.parent().length === 0 ||
								( buildFilter.parent().length && buildFilter.parent()[0] !== $filter[0] ) ) ) {
								$filter.append( buildFilter );
							}
						} else {
							buildFilter = $( '<input type="search">' ).appendTo( $filter );
						}
						if ( buildFilter ) {
							tmp = $header.data( 'placeholder' ) ||
								$header.attr( 'data-placeholder' ) ||
								wo.filter_placeholder.search || '';
							buildFilter.attr( 'placeholder', tmp );
						}
					}
					if ( buildFilter ) {
						// add filter class name
						name = ( $.isArray( wo.filter_cssFilter ) ?
							( typeof wo.filter_cssFilter[column] !== 'undefined' ? wo.filter_cssFilter[column] || '' : '' ) :
							wo.filter_cssFilter ) || '';
						// copy data-column from table cell (it will include colspan)
						buildFilter.addClass( tscss.filter + ' ' + name ).attr( 'data-column', $filter.attr( 'data-column' ) );
						if ( disabled ) {
							buildFilter.attr( 'placeholder', '' ).addClass( tscss.filterDisabled )[0].disabled = true;
						}
					}
				}
			}
		},
		bindSearch: function( table, $el, internal ) {
			table = $( table )[0];
			$el = $( $el ); // allow passing a selector string
			if ( !$el.length ) { return; }
			var tmp,
				c = table.config,
				wo = c.widgetOptions,
				namespace = c.namespace + 'filter',
				$ext = wo.filter_$externalFilters;
			if ( internal !== true ) {
				// save anyMatch element
				tmp = wo.filter_anyColumnSelector + ',' + wo.filter_multipleColumnSelector;
				wo.filter_$anyMatch = $el.filter( tmp );
				if ( $ext && $ext.length ) {
					wo.filter_$externalFilters = wo.filter_$externalFilters.add( $el );
				} else {
					wo.filter_$externalFilters = $el;
				}
				// update values ( external filters added after table initialization )
				ts.setFilters( table, c.$table.data( 'lastSearch' ) || [], internal === false );
			}
			// unbind events
			tmp = ( 'keypress keyup keydown search change input '.split( ' ' ).join( namespace + ' ' ) );
			$el
			// use data attribute instead of jQuery data since the head is cloned without including
			// the data/binding
			.attr( 'data-lastSearchTime', new Date().getTime() )
			.unbind( tmp.replace( ts.regex.spaces, ' ' ) )
			.bind( 'keydown' + namespace, function( event ) {
				if ( event.which === tskeyCodes.escape && !wo.filter_resetOnEsc ) {
					// prevent keypress event
					return false;
				}
			})
			.bind( 'keyup' + namespace, function( event ) {
				var column = parseInt( $( this ).attr( 'data-column' ), 10 );
				$( this ).attr( 'data-lastSearchTime', new Date().getTime() );
				// emulate what webkit does.... escape clears the filter
				if ( event.which === tskeyCodes.escape ) {
					// make sure to restore the last value on escape
					this.value = wo.filter_resetOnEsc ? '' : c.lastSearch[column];
				// live search
				} else if ( wo.filter_liveSearch === false ) {
					return;
					// don't return if the search value is empty ( all rows need to be revealed )
				} else if ( this.value !== '' && (
					// liveSearch can contain a min value length; ignore arrow and meta keys, but allow backspace
					( typeof wo.filter_liveSearch === 'number' && this.value.length < wo.filter_liveSearch ) ||
					// let return & backspace continue on, but ignore arrows & non-valid characters
					( event.which !== tskeyCodes.enter && event.which !== tskeyCodes.backSpace &&
						( event.which < tskeyCodes.space || ( event.which >= tskeyCodes.left && event.which <= tskeyCodes.down ) ) ) ) ) {
					return;
				}
				// change event = no delay; last true flag tells getFilters to skip newest timed input
				tsf.searching( table, true, true );
			})
			// include change for select - fixes #473
			.bind( 'search change keypress input '.split( ' ' ).join( namespace + ' ' ), function( event ) {
				// don't get cached data, in case data-column changes dynamically
				var column = parseInt( $( this ).attr( 'data-column' ), 10 );
				// don't allow 'change' event to process if the input value is the same - fixes #685
				if ( wo.filter_initialized && ( event.which === tskeyCodes.enter || event.type === 'search' ||
					( event.type === 'change' ) && this.value !== c.lastSearch[column] ) ||
					// only "input" event fires in MS Edge when clicking the "x" to clear the search
					( event.type === 'input' && this.value === '' ) ) {
					event.preventDefault();
					// init search with no delay
					$( this ).attr( 'data-lastSearchTime', new Date().getTime() );
					tsf.searching( table, event.type !== 'keypress', true );
				}
			});
		},
		searching: function( table, filter, skipFirst ) {
			var wo = table.config.widgetOptions;
			clearTimeout( wo.filter_searchTimer );
			if ( typeof filter === 'undefined' || filter === true ) {
				// delay filtering
				wo.filter_searchTimer = setTimeout( function() {
					tsf.checkFilters( table, filter, skipFirst );
				}, wo.filter_liveSearch ? wo.filter_searchDelay : 10 );
			} else {
				// skip delay
				tsf.checkFilters( table, filter, skipFirst );
			}
		},
		checkFilters: function( table, filter, skipFirst ) {
			var c = table.config,
				wo = c.widgetOptions,
				filterArray = $.isArray( filter ),
				filters = ( filterArray ) ? filter : ts.getFilters( table, true ),
				combinedFilters = ( filters || [] ).join( '' ); // combined filter values
			// prevent errors if delay init is set
			if ( $.isEmptyObject( c.cache ) ) {
				// update cache if delayInit set & pager has initialized ( after user initiates a search )
				if ( c.delayInit && c.pager && c.pager.initialized ) {
					ts.updateCache( c, function() {
						tsf.checkFilters( table, false, skipFirst );
					});
				}
				return;
			}
			// add filter array back into inputs
			if ( filterArray ) {
				ts.setFilters( table, filters, false, skipFirst !== true );
				if ( !wo.filter_initialized ) { c.lastCombinedFilter = ''; }
			}
			if ( wo.filter_hideFilters ) {
				// show/hide filter row as needed
				c.$table
					.find( '.' + tscss.filterRow )
					.triggerHandler( combinedFilters === '' ? 'mouseleave' : 'mouseenter' );
			}
			// return if the last search is the same; but filter === false when updating the search
			// see example-widget-filter.html filter toggle buttons
			if ( c.lastCombinedFilter === combinedFilters && filter !== false ) {
				return;
			} else if ( filter === false ) {
				// force filter refresh
				c.lastCombinedFilter = null;
				c.lastSearch = [];
			}
			// define filter inside it is false
			filters = filters || [];
			// convert filters to strings - see #1070
			filters = Array.prototype.map ?
				filters.map( String ) :
				// for IE8 & older browsers - maybe not the best method
				filters.join( '\ufffd' ).split( '\ufffd' );

			if ( wo.filter_initialized ) {
				c.$table.triggerHandler( 'filterStart', [ filters ] );
			}
			if ( c.showProcessing ) {
				// give it time for the processing icon to kick in
				setTimeout( function() {
					tsf.findRows( table, filters, combinedFilters );
					return false;
				}, 30 );
			} else {
				tsf.findRows( table, filters, combinedFilters );
				return false;
			}
		},
		hideFilters: function( c, $table ) {
			var timer,
				$row = ( $table || c.$table ).find( '.' + tscss.filterRow ).addClass( tscss.filterRowHide );
			$row
				.bind( 'mouseenter mouseleave', function( e ) {
					// save event object - http://bugs.jquery.com/ticket/12140
					var event = e,
						$filterRow = $( this );
					clearTimeout( timer );
					timer = setTimeout( function() {
						if ( /enter|over/.test( event.type ) ) {
							$filterRow.removeClass( tscss.filterRowHide );
						} else {
							// don't hide if input has focus
							// $( ':focus' ) needs jQuery 1.6+
							if ( $( document.activeElement ).closest( 'tr' )[0] !== $filterRow[0] ) {
								// don't hide row if any filter has a value
								if ( c.lastCombinedFilter === '' ) {
									$filterRow.addClass( tscss.filterRowHide );
								}
							}
						}
					}, 200 );
				})
				.find( 'input, select' ).bind( 'focus blur', function( e ) {
					var event = e,
						$row = $( this ).closest( 'tr' );
					clearTimeout( timer );
					timer = setTimeout( function() {
						clearTimeout( timer );
						// don't hide row if any filter has a value
						if ( ts.getFilters( c.$table ).join( '' ) === '' ) {
							$row.toggleClass( tscss.filterRowHide, event.type !== 'focus' );
						}
					}, 200 );
				});
		},
		defaultFilter: function( filter, mask ) {
			if ( filter === '' ) { return filter; }
			var regex = tsfRegex.iQuery,
				maskLen = mask.match( tsfRegex.igQuery ).length,
				query = maskLen > 1 ? $.trim( filter ).split( /\s/ ) : [ $.trim( filter ) ],
				len = query.length - 1,
				indx = 0,
				val = mask;
			if ( len < 1 && maskLen > 1 ) {
				// only one 'word' in query but mask has >1 slots
				query[1] = query[0];
			}
			// replace all {query} with query words...
			// if query = 'Bob', then convert mask from '!{query}' to '!Bob'
			// if query = 'Bob Joe Frank', then convert mask '{q} OR {q}' to 'Bob OR Joe OR Frank'
			while ( regex.test( val ) ) {
				val = val.replace( regex, query[indx++] || '' );
				if ( regex.test( val ) && indx < len && ( query[indx] || '' ) !== '' ) {
					val = mask.replace( regex, val );
				}
			}
			return val;
		},
		getLatestSearch: function( $input ) {
			if ( $input ) {
				return $input.sort( function( a, b ) {
					return $( b ).attr( 'data-lastSearchTime' ) - $( a ).attr( 'data-lastSearchTime' );
				});
			}
			return $input || $();
		},
		findRange: function( c, val, ignoreRanges ) {
			// look for multiple columns '1-3,4-6,8' in data-column
			var temp, ranges, range, start, end, singles, i, indx, len,
				columns = [];
			if ( /^[0-9]+$/.test( val ) ) {
				// always return an array
				return [ parseInt( val, 10 ) ];
			}
			// process column range
			if ( !ignoreRanges && /-/.test( val ) ) {
				ranges = val.match( /(\d+)\s*-\s*(\d+)/g );
				len = ranges ? ranges.length : 0;
				for ( indx = 0; indx < len; indx++ ) {
					range = ranges[indx].split( /\s*-\s*/ );
					start = parseInt( range[0], 10 ) || 0;
					end = parseInt( range[1], 10 ) || ( c.columns - 1 );
					if ( start > end ) {
						temp = start; start = end; end = temp; // swap
					}
					if ( end >= c.columns ) {
						end = c.columns - 1;
					}
					for ( ; start <= end; start++ ) {
						columns.push( start );
					}
					// remove processed range from val
					val = val.replace( ranges[ indx ], '' );
				}
			}
			// process single columns
			if ( !ignoreRanges && /,/.test( val ) ) {
				singles = val.split( /\s*,\s*/ );
				len = singles.length;
				for ( i = 0; i < len; i++ ) {
					if ( singles[ i ] !== '' ) {
						indx = parseInt( singles[ i ], 10 );
						if ( indx < c.columns ) {
							columns.push( indx );
						}
					}
				}
			}
			// return all columns
			if ( !columns.length ) {
				for ( indx = 0; indx < c.columns; indx++ ) {
					columns.push( indx );
				}
			}
			return columns;
		},
		getColumnElm: function( c, $elements, column ) {
			// data-column may contain multiple columns '1-3,5-6,8'
			// replaces: c.$filters.filter( '[data-column="' + column + '"]' );
			return $elements.filter( function() {
				var cols = tsf.findRange( c, $( this ).attr( 'data-column' ) );
				return $.inArray( column, cols ) > -1;
			});
		},
		multipleColumns: function( c, $input ) {
			// look for multiple columns '1-3,4-6,8' in data-column
			var wo = c.widgetOptions,
				// only target 'all' column inputs on initialization
				// & don't target 'all' column inputs if they don't exist
				targets = wo.filter_initialized || !$input.filter( wo.filter_anyColumnSelector ).length,
				val = $.trim( tsf.getLatestSearch( $input ).attr( 'data-column' ) || '' );
			return tsf.findRange( c, val, !targets );
		},
		processTypes: function( c, data, vars ) {
			var ffxn,
				filterMatched = null,
				matches = null;
			for ( ffxn in tsf.types ) {
				if ( $.inArray( ffxn, vars.excludeMatch ) < 0 && matches === null ) {
					matches = tsf.types[ffxn]( c, data, vars );
					if ( matches !== null ) {
						filterMatched = matches;
					}
				}
			}
			return filterMatched;
		},
		processRow: function( c, data, vars ) {
			var result, filterMatched,
				fxn, ffxn, txt,
				wo = c.widgetOptions,
				showRow = true,

				// if wo.filter_$anyMatch data-column attribute is changed dynamically
				// we don't want to do an "anyMatch" search on one column using data
				// for the entire row - see #998
				columnIndex = wo.filter_$anyMatch && wo.filter_$anyMatch.length ?
					// look for multiple columns '1-3,4-6,8'
					tsf.multipleColumns( c, wo.filter_$anyMatch ) :
					[];

			data.$cells = data.$row.children();

			if ( data.anyMatchFlag && columnIndex.length > 1 ) {
				data.anyMatch = true;
				data.isMatch = true;
				data.rowArray = data.$cells.map( function( i ) {
					if ( $.inArray( i, columnIndex ) > -1 ) {
						if ( data.parsed[ i ] ) {
							txt = data.cacheArray[ i ];
						} else {
							txt = data.rawArray[ i ];
							txt = $.trim( wo.filter_ignoreCase ? txt.toLowerCase() : txt );
							if ( c.sortLocaleCompare ) {
								txt = ts.replaceAccents( txt );
							}
						}
						return txt;
					}
				}).get();
				data.filter = data.anyMatchFilter;
				data.iFilter = data.iAnyMatchFilter;
				data.exact = data.rowArray.join( ' ' );
				data.iExact = wo.filter_ignoreCase ? data.exact.toLowerCase() : data.exact;
				data.cache = data.cacheArray.slice( 0, -1 ).join( ' ' );

				vars.excludeMatch = vars.noAnyMatch;
				filterMatched = tsf.processTypes( c, data, vars );
				if ( filterMatched !== null ) {
					showRow = filterMatched;
				} else {
					if ( wo.filter_startsWith ) {
						showRow = false;
						// data.rowArray may not contain all columns
						columnIndex = Math.min( c.columns, data.rowArray.length );
						while ( !showRow && columnIndex > 0 ) {
							columnIndex--;
							showRow = showRow || data.rowArray[ columnIndex ].indexOf( data.iFilter ) === 0;
						}
					} else {
						showRow = ( data.iExact + data.childRowText ).indexOf( data.iFilter ) >= 0;
					}
				}
				data.anyMatch = false;
				// no other filters to process
				if ( data.filters.join( '' ) === data.filter ) {
					return showRow;
				}
			}

			for ( columnIndex = 0; columnIndex < c.columns; columnIndex++ ) {
				data.filter = data.filters[ columnIndex ];
				data.index = columnIndex;

				// filter types to exclude, per column
				vars.excludeMatch = vars.excludeFilter[ columnIndex ];

				// ignore if filter is empty or disabled
				if ( data.filter ) {
					data.cache = data.cacheArray[ columnIndex ];
					result = data.rawArray[ columnIndex ] || '';
					data.exact = c.sortLocaleCompare ? ts.replaceAccents( result ) : result; // issue #405
					data.iExact = !tsfRegex.type.test( typeof data.exact ) && wo.filter_ignoreCase ?
						data.exact.toLowerCase() : data.exact;

					data.isMatch = c.$headerIndexed[ data.index ].hasClass( 'filter-match' );

					result = showRow; // if showRow is true, show that row

					// in case select filter option has a different value vs text 'a - z|A through Z'
					ffxn = wo.filter_columnFilters ?
						c.$filters.add( c.$externalFilters )
							.filter( '[data-column="' + columnIndex + '"]' )
							.find( 'select option:selected' )
							.attr( 'data-function-name' ) || '' : '';
					// replace accents - see #357
					if ( c.sortLocaleCompare ) {
						data.filter = ts.replaceAccents( data.filter );
					}

					// replace column specific default filters - see #1088
					if ( wo.filter_defaultFilter && tsfRegex.iQuery.test( vars.defaultColFilter[ columnIndex ] ) ) {
						data.filter = tsf.defaultFilter( data.filter, vars.defaultColFilter[ columnIndex ] );
					}

					// data.iFilter = case insensitive ( if wo.filter_ignoreCase is true ),
					// data.filter = case sensitive
					data.iFilter = wo.filter_ignoreCase ? ( data.filter || '' ).toLowerCase() : data.filter;
					fxn = vars.functions[ columnIndex ];
					filterMatched = null;
					if ( fxn ) {
						if ( fxn === true ) {
							// default selector uses exact match unless 'filter-match' class is found
							filterMatched = data.isMatch ?
								// data.iExact may be a number
								( '' + data.iExact ).search( data.iFilter ) >= 0 :
								data.filter === data.exact;
						} else if ( typeof fxn === 'function' ) {
							// filter callback( exact cell content, parser normalized content,
							// filter input value, column index, jQuery row object )
							filterMatched = fxn( data.exact, data.cache, data.filter, columnIndex, data.$row, c, data );
						} else if ( typeof fxn[ ffxn || data.filter ] === 'function' ) {
							// selector option function
							txt = ffxn || data.filter;
							filterMatched =
								fxn[ txt ]( data.exact, data.cache, data.filter, columnIndex, data.$row, c, data );
						}
					}
					if ( filterMatched === null ) {
						// cycle through the different filters
						// filters return a boolean or null if nothing matches
						filterMatched = tsf.processTypes( c, data, vars );
						if ( filterMatched !== null ) {
							result = filterMatched;
						// Look for match, and add child row data for matching
						} else {
							txt = ( data.iExact + data.childRowText ).indexOf( tsf.parseFilter( c, data.iFilter, data ) );
							result = ( ( !wo.filter_startsWith && txt >= 0 ) || ( wo.filter_startsWith && txt === 0 ) );
						}
					} else {
						result = filterMatched;
					}
					showRow = ( result ) ? showRow : false;
				}
			}
			return showRow;
		},
		findRows: function( table, filters, combinedFilters ) {
			if ( table.config.lastCombinedFilter === combinedFilters ||
				!table.config.widgetOptions.filter_initialized ) {
				return;
			}
			var len, norm_rows, rowData, $rows, $row, rowIndex, tbodyIndex, $tbody, columnIndex,
				isChild, childRow, lastSearch, showRow, showParent, time, val, indx,
				notFiltered, searchFiltered, query, injected, res, id, txt,
				storedFilters = $.extend( [], filters ),
				c = table.config,
				wo = c.widgetOptions,
				// data object passed to filters; anyMatch is a flag for the filters
				data = {
					anyMatch: false,
					filters: filters,
					// regex filter type cache
					filter_regexCache : []
				},
				vars = {
					// anyMatch really screws up with these types of filters
					noAnyMatch: [ 'range', 'notMatch',  'operators' ],
					// cache filter variables that use ts.getColumnData in the main loop
					functions : [],
					excludeFilter : [],
					defaultColFilter : [],
					defaultAnyFilter : ts.getColumnData( table, wo.filter_defaultFilter, c.columns, true ) || ''
				};

			// parse columns after formatter, in case the class is added at that point
			data.parsed = [];
			for ( columnIndex = 0; columnIndex < c.columns; columnIndex++ ) {
				data.parsed[ columnIndex ] = wo.filter_useParsedData ||
					// parser has a "parsed" parameter
					( c.parsers && c.parsers[ columnIndex ] && c.parsers[ columnIndex ].parsed ||
					// getData may not return 'parsed' if other 'filter-' class names exist
					// ( e.g. <th class="filter-select filter-parsed"> )
					ts.getData && ts.getData( c.$headerIndexed[ columnIndex ],
						ts.getColumnData( table, c.headers, columnIndex ), 'filter' ) === 'parsed' ||
					c.$headerIndexed[ columnIndex ].hasClass( 'filter-parsed' ) );

				vars.functions[ columnIndex ] =
					ts.getColumnData( table, wo.filter_functions, columnIndex ) ||
					c.$headerIndexed[ columnIndex ].hasClass( 'filter-select' );
				vars.defaultColFilter[ columnIndex ] =
					ts.getColumnData( table, wo.filter_defaultFilter, columnIndex ) || '';
				vars.excludeFilter[ columnIndex ] =
					( ts.getColumnData( table, wo.filter_excludeFilter, columnIndex, true ) || '' ).split( /\s+/ );
			}

			if ( c.debug ) {
				console.log( 'Filter: Starting filter widget search', filters );
				time = new Date();
			}
			// filtered rows count
			c.filteredRows = 0;
			c.totalRows = 0;
			// combindedFilters are undefined on init
			combinedFilters = ( storedFilters || [] ).join( '' );

			for ( tbodyIndex = 0; tbodyIndex < c.$tbodies.length; tbodyIndex++ ) {
				$tbody = ts.processTbody( table, c.$tbodies.eq( tbodyIndex ), true );
				// skip child rows & widget added ( removable ) rows - fixes #448 thanks to @hempel!
				// $rows = $tbody.children( 'tr' ).not( c.selectorRemove );
				columnIndex = c.columns;
				// convert stored rows into a jQuery object
				norm_rows = c.cache[ tbodyIndex ].normalized;
				$rows = $( $.map( norm_rows, function( el ) {
					return el[ columnIndex ].$row.get();
				}) );

				if ( combinedFilters === '' || wo.filter_serversideFiltering ) {
					$rows
						.removeClass( wo.filter_filteredRow )
						.not( '.' + c.cssChildRow )
						.css( 'display', '' );
				} else {
					// filter out child rows
					$rows = $rows.not( '.' + c.cssChildRow );
					len = $rows.length;

					if ( ( wo.filter_$anyMatch && wo.filter_$anyMatch.length ) ||
						typeof filters[c.columns] !== 'undefined' ) {
						data.anyMatchFlag = true;
						data.anyMatchFilter = '' + (
							filters[ c.columns ] ||
							wo.filter_$anyMatch && tsf.getLatestSearch( wo.filter_$anyMatch ).val() ||
							''
						);
						if ( wo.filter_columnAnyMatch ) {
							// specific columns search
							query = data.anyMatchFilter.split( tsfRegex.andSplit );
							injected = false;
							for ( indx = 0; indx < query.length; indx++ ) {
								res = query[ indx ].split( ':' );
								if ( res.length > 1 ) {
									// make the column a one-based index ( non-developers start counting from one :P )
									id = parseInt( res[0], 10 ) - 1;
									if ( id >= 0 && id < c.columns ) { // if id is an integer
										filters[ id ] = res[1];
										query.splice( indx, 1 );
										indx--;
										injected = true;
									}
								}
							}
							if ( injected ) {
								data.anyMatchFilter = query.join( ' && ' );
							}
						}
					}

					// optimize searching only through already filtered rows - see #313
					searchFiltered = wo.filter_searchFiltered;
					lastSearch = c.lastSearch || c.$table.data( 'lastSearch' ) || [];
					if ( searchFiltered ) {
						// cycle through all filters; include last ( columnIndex + 1 = match any column ). Fixes #669
						for ( indx = 0; indx < columnIndex + 1; indx++ ) {
							val = filters[indx] || '';
							// break out of loop if we've already determined not to search filtered rows
							if ( !searchFiltered ) { indx = columnIndex; }
							// search already filtered rows if...
							searchFiltered = searchFiltered && lastSearch.length &&
								// there are no changes from beginning of filter
								val.indexOf( lastSearch[indx] || '' ) === 0 &&
								// if there is NOT a logical 'or', or range ( 'to' or '-' ) in the string
								!tsfRegex.alreadyFiltered.test( val ) &&
								// if we are not doing exact matches, using '|' ( logical or ) or not '!'
								!tsfRegex.exactTest.test( val ) &&
								// don't search only filtered if the value is negative
								// ( '> -10' => '> -100' will ignore hidden rows )
								!( tsfRegex.isNeg1.test( val ) || tsfRegex.isNeg2.test( val ) ) &&
								// if filtering using a select without a 'filter-match' class ( exact match ) - fixes #593
								!( val !== '' && c.$filters && c.$filters.filter( '[data-column="' + indx + '"]' ).find( 'select' ).length &&
									!c.$headerIndexed[indx].hasClass( 'filter-match' ) );
						}
					}
					notFiltered = $rows.not( '.' + wo.filter_filteredRow ).length;
					// can't search when all rows are hidden - this happens when looking for exact matches
					if ( searchFiltered && notFiltered === 0 ) { searchFiltered = false; }
					if ( c.debug ) {
						console.log( 'Filter: Searching through ' +
							( searchFiltered && notFiltered < len ? notFiltered : 'all' ) + ' rows' );
					}
					if ( data.anyMatchFlag ) {
						if ( c.sortLocaleCompare ) {
							// replace accents
							data.anyMatchFilter = ts.replaceAccents( data.anyMatchFilter );
						}
						if ( wo.filter_defaultFilter && tsfRegex.iQuery.test( vars.defaultAnyFilter ) ) {
							data.anyMatchFilter = tsf.defaultFilter( data.anyMatchFilter, vars.defaultAnyFilter );
							// clear search filtered flag because default filters are not saved to the last search
							searchFiltered = false;
						}
						// make iAnyMatchFilter lowercase unless both filter widget & core ignoreCase options are true
						// when c.ignoreCase is true, the cache contains all lower case data
						data.iAnyMatchFilter = !( wo.filter_ignoreCase && c.ignoreCase ) ?
							data.anyMatchFilter :
							data.anyMatchFilter.toLowerCase();
					}

					// loop through the rows
					for ( rowIndex = 0; rowIndex < len; rowIndex++ ) {

						txt = $rows[ rowIndex ].className;
						// the first row can never be a child row
						isChild = rowIndex && tsfRegex.child.test( txt );
						// skip child rows & already filtered rows
						if ( isChild || ( searchFiltered && tsfRegex.filtered.test( txt ) ) ) {
							continue;
						}

						data.$row = $rows.eq( rowIndex );
						data.cacheArray = norm_rows[ rowIndex ];
						rowData = data.cacheArray[ c.columns ];
						data.rawArray = rowData.raw;
						data.childRowText = '';

						if ( !wo.filter_childByColumn ) {
							txt = '';
							// child row cached text
							childRow = rowData.child;
							// so, if 'table.config.widgetOptions.filter_childRows' is true and there is
							// a match anywhere in the child row, then it will make the row visible
							// checked here so the option can be changed dynamically
							for ( indx = 0; indx < childRow.length; indx++ ) {
								txt += ' ' + childRow[indx].join( ' ' ) || '';
							}
							data.childRowText = wo.filter_childRows ?
								( wo.filter_ignoreCase ? txt.toLowerCase() : txt ) :
								'';
						}

						showRow = false;
						showParent = tsf.processRow( c, data, vars );
						$row = rowData.$row;

						// don't pass reference to val
						val = showParent ? true : false;
						childRow = rowData.$row.filter( ':gt(0)' );
						if ( wo.filter_childRows && childRow.length ) {
							if ( wo.filter_childByColumn ) {
								if ( !wo.filter_childWithSibs ) {
									// hide all child rows
									childRow.addClass( wo.filter_filteredRow );
									// if only showing resulting child row, only include parent
									$row = $row.eq( 0 );
								}
								// cycle through each child row
								for ( indx = 0; indx < childRow.length; indx++ ) {
									data.$row = childRow.eq( indx );
									data.cacheArray = rowData.child[ indx ];
									data.rawArray = data.cacheArray;
									val = tsf.processRow( c, data, vars );
									// use OR comparison on child rows
									showRow = showRow || val;
									if ( !wo.filter_childWithSibs && val ) {
										childRow.eq( indx ).removeClass( wo.filter_filteredRow );
									}
								}
							}
							// keep parent row match even if no child matches... see #1020
							showRow = showRow || showParent;
						} else {
							showRow = val;
						}
						$row
							.toggleClass( wo.filter_filteredRow, !showRow )[0]
							.display = showRow ? '' : 'none';
					}
				}
				c.filteredRows += $rows.not( '.' + wo.filter_filteredRow ).length;
				c.totalRows += $rows.length;
				ts.processTbody( table, $tbody, false );
			}
			c.lastCombinedFilter = combinedFilters; // save last search
			// don't save 'filters' directly since it may have altered ( AnyMatch column searches )
			c.lastSearch = storedFilters;
			c.$table.data( 'lastSearch', storedFilters );
			if ( wo.filter_saveFilters && ts.storage ) {
				ts.storage( table, 'tablesorter-filters', tsf.processFilters( storedFilters, true ) );
			}
			if ( c.debug ) {
				console.log( 'Completed filter widget search' + ts.benchmark(time) );
			}
			if ( wo.filter_initialized ) {
				c.$table.triggerHandler( 'filterBeforeEnd', c );
				c.$table.triggerHandler( 'filterEnd', c );
			}
			setTimeout( function() {
				ts.applyWidget( c.table ); // make sure zebra widget is applied
			}, 0 );
		},
		getOptionSource: function( table, column, onlyAvail ) {
			table = $( table )[0];
			var c = table.config,
				wo = c.widgetOptions,
				arry = false,
				source = wo.filter_selectSource,
				last = c.$table.data( 'lastSearch' ) || [],
				fxn = typeof source === 'function' ? true : ts.getColumnData( table, source, column );

			if ( onlyAvail && last[column] !== '' ) {
				onlyAvail = false;
			}

			// filter select source option
			if ( fxn === true ) {
				// OVERALL source
				arry = source( table, column, onlyAvail );
			} else if ( fxn instanceof $ || ( $.type( fxn ) === 'string' && fxn.indexOf( '</option>' ) >= 0 ) ) {
				// selectSource is a jQuery object or string of options
				return fxn;
			} else if ( $.isArray( fxn ) ) {
				arry = fxn;
			} else if ( $.type( source ) === 'object' && fxn ) {
				// custom select source function for a SPECIFIC COLUMN
				arry = fxn( table, column, onlyAvail );
			}
			if ( arry === false ) {
				// fall back to original method
				arry = tsf.getOptions( table, column, onlyAvail );
			}

			return tsf.processOptions( table, column, arry );

		},
		processOptions: function( table, column, arry ) {
			if ( !$.isArray( arry ) ) {
				return false;
			}
			table = $( table )[0];
			var cts, txt, indx, len, parsedTxt, str,
				c = table.config,
				validColumn = typeof column !== 'undefined' && column !== null && column >= 0 && column < c.columns,
				parsed = [];
			// get unique elements and sort the list
			// if $.tablesorter.sortText exists ( not in the original tablesorter ),
			// then natural sort the list otherwise use a basic sort
			arry = $.grep( arry, function( value, indx ) {
				if ( value.text ) {
					return true;
				}
				return $.inArray( value, arry ) === indx;
			});
			if ( validColumn && c.$headerIndexed[ column ].hasClass( 'filter-select-nosort' ) ) {
				// unsorted select options
				return arry;
			} else {
				len = arry.length;
				// parse select option values
				for ( indx = 0; indx < len; indx++ ) {
					txt = arry[ indx ];
					// check for object
					str = txt.text ? txt.text : txt;
					// sortNatural breaks if you don't pass it strings
					parsedTxt = ( validColumn && c.parsers && c.parsers.length &&
						c.parsers[ column ].format( str, table, [], column ) || str ).toString();
					parsedTxt = c.widgetOptions.filter_ignoreCase ? parsedTxt.toLowerCase() : parsedTxt;
					// parse array data using set column parser; this DOES NOT pass the original
					// table cell to the parser format function
					if ( txt.text ) {
						txt.parsed = parsedTxt;
						parsed.push( txt );
					} else {
						parsed.push({
							text : txt,
							// check parser length - fixes #934
							parsed : parsedTxt
						});
					}
				}
				// sort parsed select options
				cts = c.textSorter || '';
				parsed.sort( function( a, b ) {
					var x = a.parsed,
						y = b.parsed;
					if ( validColumn && typeof cts === 'function' ) {
						// custom OVERALL text sorter
						return cts( x, y, true, column, table );
					} else if ( validColumn && typeof cts === 'object' && cts.hasOwnProperty( column ) ) {
						// custom text sorter for a SPECIFIC COLUMN
						return cts[column]( x, y, true, column, table );
					} else if ( ts.sortNatural ) {
						// fall back to natural sort
						return ts.sortNatural( x, y );
					}
					// using an older version! do a basic sort
					return true;
				});
				// rebuild arry from sorted parsed data
				arry = [];
				len = parsed.length;
				for ( indx = 0; indx < len; indx++ ) {
					arry.push( parsed[indx] );
				}
				return arry;
			}
		},
		getOptions: function( table, column, onlyAvail ) {
			table = $( table )[0];
			var rowIndex, tbodyIndex, len, row, cache, indx, child, childLen,
				c = table.config,
				wo = c.widgetOptions,
				arry = [];
			for ( tbodyIndex = 0; tbodyIndex < c.$tbodies.length; tbodyIndex++ ) {
				cache = c.cache[tbodyIndex];
				len = c.cache[tbodyIndex].normalized.length;
				// loop through the rows
				for ( rowIndex = 0; rowIndex < len; rowIndex++ ) {
					// get cached row from cache.row ( old ) or row data object
					// ( new; last item in normalized array )
					row = cache.row ?
						cache.row[ rowIndex ] :
						cache.normalized[ rowIndex ][ c.columns ].$row[0];
					// check if has class filtered
					if ( onlyAvail && row.className.match( wo.filter_filteredRow ) ) {
						continue;
					}
					// get non-normalized cell content
					if ( wo.filter_useParsedData ||
						c.parsers[column].parsed ||
						c.$headerIndexed[column].hasClass( 'filter-parsed' ) ) {
						arry.push( '' + cache.normalized[ rowIndex ][ column ] );
						// child row parsed data
						if ( wo.filter_childRows && wo.filter_childByColumn ) {
							childLen = cache.normalized[ rowIndex ][ c.columns ].$row.length - 1;
							for ( indx = 0; indx < childLen; indx++ ) {
								arry.push( '' + cache.normalized[ rowIndex ][ c.columns ].child[ indx ][ column ] );
							}
						}
					} else {
						// get raw cached data instead of content directly from the cells
						arry.push( cache.normalized[ rowIndex ][ c.columns ].raw[ column ] );
						// child row unparsed data
						if ( wo.filter_childRows && wo.filter_childByColumn ) {
							childLen = cache.normalized[ rowIndex ][ c.columns ].$row.length;
							for ( indx = 1; indx < childLen; indx++ ) {
								child =  cache.normalized[ rowIndex ][ c.columns ].$row.eq( indx ).children().eq( column );
								arry.push( '' + ts.getElementText( c, child, column ) );
							}
						}
					}
				}
			}
			return arry;
		},
		buildSelect: function( table, column, arry, updating, onlyAvail ) {
			table = $( table )[0];
			column = parseInt( column, 10 );
			if ( !table.config.cache || $.isEmptyObject( table.config.cache ) ) {
				return;
			}

			var indx, val, txt, t, $filters, $filter, option,
				c = table.config,
				wo = c.widgetOptions,
				node = c.$headerIndexed[ column ],
				// t.data( 'placeholder' ) won't work in jQuery older than 1.4.3
				options = '<option value="">' +
					( node.data( 'placeholder' ) ||
						node.attr( 'data-placeholder' ) ||
						wo.filter_placeholder.select || ''
					) + '</option>',
				// Get curent filter value
				currentValue = c.$table
					.find( 'thead' )
					.find( 'select.' + tscss.filter + '[data-column="' + column + '"]' )
					.val();

			// nothing included in arry ( external source ), so get the options from
			// filter_selectSource or column data
			if ( typeof arry === 'undefined' || arry === '' ) {
				arry = tsf.getOptionSource( table, column, onlyAvail );
			}

			if ( $.isArray( arry ) ) {
				// build option list
				for ( indx = 0; indx < arry.length; indx++ ) {
					option = arry[ indx ];
					if ( option.text ) {
						// OBJECT!! add data-function-name in case the value is set in filter_functions
						option['data-function-name'] = typeof option.value === 'undefined' ? option.text : option.value;

						// support jQuery < v1.8, otherwise the below code could be shortened to
						// options += $( '<option>', option )[ 0 ].outerHTML;
						options += '<option';
						for ( val in option ) {
							if ( option.hasOwnProperty( val ) && val !== 'text' ) {
								options += ' ' + val + '="' + option[ val ] + '"';
							}
						}
						if ( !option.value ) {
							options += ' value="' + option.text + '"';
						}
						options += '>' + option.text + '</option>';
						// above code is needed in jQuery < v1.8

						// make sure we don't turn an object into a string (objects without a "text" property)
					} else if ( '' + option !== '[object Object]' ) {
						txt = option = ( '' + option ).replace( tsfRegex.quote, '&quot;' );
						val = txt;
						// allow including a symbol in the selectSource array
						// 'a-z|A through Z' so that 'a-z' becomes the option value
						// and 'A through Z' becomes the option text
						if ( txt.indexOf( wo.filter_selectSourceSeparator ) >= 0 ) {
							t = txt.split( wo.filter_selectSourceSeparator );
							val = t[0];
							txt = t[1];
						}
						// replace quotes - fixes #242 & ignore empty strings
						// see http://stackoverflow.com/q/14990971/145346
						options += option !== '' ?
							'<option ' +
								( val === txt ? '' : 'data-function-name="' + option + '" ' ) +
								'value="' + val + '">' + txt +
							'</option>' : '';
					}
				}
				// clear arry so it doesn't get appended twice
				arry = [];
			}

			// update all selects in the same column ( clone thead in sticky headers &
			// any external selects ) - fixes 473
			$filters = ( c.$filters ? c.$filters : c.$table.children( 'thead' ) )
				.find( '.' + tscss.filter );
			if ( wo.filter_$externalFilters ) {
				$filters = $filters && $filters.length ?
					$filters.add( wo.filter_$externalFilters ) :
					wo.filter_$externalFilters;
			}
			$filter = $filters.filter( 'select[data-column="' + column + '"]' );

			// make sure there is a select there!
			if ( $filter.length ) {
				$filter[ updating ? 'html' : 'append' ]( options );
				if ( !$.isArray( arry ) ) {
					// append options if arry is provided externally as a string or jQuery object
					// options ( default value ) was already added
					$filter.append( arry ).val( currentValue );
				}
				$filter.val( currentValue );
			}
		},
		buildDefault: function( table, updating ) {
			var columnIndex, $header, noSelect,
				c = table.config,
				wo = c.widgetOptions,
				columns = c.columns;
			// build default select dropdown
			for ( columnIndex = 0; columnIndex < columns; columnIndex++ ) {
				$header = c.$headerIndexed[columnIndex];
				noSelect = !( $header.hasClass( 'filter-false' ) || $header.hasClass( 'parser-false' ) );
				// look for the filter-select class; build/update it if found
				if ( ( $header.hasClass( 'filter-select' ) ||
					ts.getColumnData( table, wo.filter_functions, columnIndex ) === true ) && noSelect ) {
					tsf.buildSelect( table, columnIndex, '', updating, $header.hasClass( wo.filter_onlyAvail ) );
				}
			}
		}
	};

	// filter regex variable
	tsfRegex = tsf.regex;

	ts.getFilters = function( table, getRaw, setFilters, skipFirst ) {
		var i, $filters, $column, cols,
			filters = false,
			c = table ? $( table )[0].config : '',
			wo = c ? c.widgetOptions : '';
		if ( ( getRaw !== true && wo && !wo.filter_columnFilters ) ||
			// setFilters called, but last search is exactly the same as the current
			// fixes issue #733 & #903 where calling update causes the input values to reset
			( $.isArray(setFilters) && setFilters.join('') === c.lastCombinedFilter ) ) {
			return $( table ).data( 'lastSearch' );
		}
		if ( c ) {
			if ( c.$filters ) {
				$filters = c.$filters.find( '.' + tscss.filter );
			}
			if ( wo.filter_$externalFilters ) {
				$filters = $filters && $filters.length ?
					$filters.add( wo.filter_$externalFilters ) :
					wo.filter_$externalFilters;
			}
			if ( $filters && $filters.length ) {
				filters = setFilters || [];
				for ( i = 0; i < c.columns + 1; i++ ) {
					cols = ( i === c.columns ?
						// 'all' columns can now include a range or set of columms ( data-column='0-2,4,6-7' )
						wo.filter_anyColumnSelector + ',' + wo.filter_multipleColumnSelector :
						'[data-column="' + i + '"]' );
					$column = $filters.filter( cols );
					if ( $column.length ) {
						// move the latest search to the first slot in the array
						$column = tsf.getLatestSearch( $column );
						if ( $.isArray( setFilters ) ) {
							// skip first ( latest input ) to maintain cursor position while typing
							if ( skipFirst && $column.length > 1 ) {
								$column = $column.slice( 1 );
							}
							if ( i === c.columns ) {
								// prevent data-column='all' from filling data-column='0,1' ( etc )
								cols = $column.filter( wo.filter_anyColumnSelector );
								$column = cols.length ? cols : $column;
							}
							$column
								.val( setFilters[ i ] )
								// must include a namespace here; but not c.namespace + 'filter'?
								.trigger( 'change' + c.namespace );
						} else {
							filters[i] = $column.val() || '';
							// don't change the first... it will move the cursor
							if ( i === c.columns ) {
								// don't update range columns from 'all' setting
								$column
									.slice( 1 )
									.filter( '[data-column*="' + $column.attr( 'data-column' ) + '"]' )
									.val( filters[ i ] );
							} else {
								$column
									.slice( 1 )
									.val( filters[ i ] );
							}
						}
						// save any match input dynamically
						if ( i === c.columns && $column.length ) {
							wo.filter_$anyMatch = $column;
						}
					}
				}
			}
		}
		if ( filters.length === 0 ) {
			filters = false;
		}
		return filters;
	};

	ts.setFilters = function( table, filter, apply, skipFirst ) {
		var c = table ? $( table )[0].config : '',
			valid = ts.getFilters( table, true, filter, skipFirst );
		// default apply to "true"
		if ( typeof apply === 'undefined' ) {
			apply = true;
		}
		if ( c && apply ) {
			// ensure new set filters are applied, even if the search is the same
			c.lastCombinedFilter = null;
			c.lastSearch = [];
			tsf.searching( c.table, filter, skipFirst );
			c.$table.triggerHandler( 'filterFomatterUpdate' );
		}
		return !!valid;
	};

})( jQuery );
