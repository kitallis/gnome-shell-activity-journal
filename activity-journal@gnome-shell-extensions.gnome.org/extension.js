/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

/* JournalDisplay object to show a timeline of the user's past activities
 *
 * This file exports a JournalDisplay object, which carries a JournalDisplay.actor.
 * This is a view of the user's past activities, shown as a timeline, and
 * whose data comes from what is logged in the Zeitgeist service.
 */

/* Style classes used here:
 *
 * journal - The main journal layout
 *     item-spacing - Horizontal space between items in the journal view
 *     row-spacing - Vertical space between rows in the journal view
 *
 * journal-heading - Heading labels for date blocks inside the journal
 *
 * .journal-item .overview-icon - Items in the journal, used to represent files/documents/etc.
 * You can style "icon-size", "font-size", etc. in them; the hierarchy for each item is
 * is StButton -> IconGrid.BaseIcon
 */

const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Shell = imports.gi.Shell;
const Lang = imports.lang;
const Signals = imports.signals;
const Search = imports.ui.search;
const DBus = imports.dbus;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;
const C_ = Gettext.pgettext;

const IconGrid = imports.ui.iconGrid;
 
//*** Semantic-desktop interpretations for various data types ***

const NFO_AUDIO                   = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Audio";
const NFO_DOCUMENT                = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Document";
const NFO_HTML_DOCUMENT           = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#HtmlDocument";
const NFO_IMAGE                   = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Image";
const NFO_MEDIA                   = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Media";
const NFO_MIND_MAP                = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#MindMap";
const NFO_PAGINATED_TEXT_DOCUMENT = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#PaginatedTextDocument";
const NFO_PLAIN_TEXT_DOCUMENT     = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#PlainTextDocument";
const NFO_PRESENTATION            = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Presentation";
const NFO_RASTER_IMAGE            = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#RasterImage";
const NFO_SOURCE_CODE             = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#SourceCode";
const NFO_SPREADSHEET             = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Spreadsheet";
const NFO_TEXT_DOCUMENT           = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#TextDocument";
const NFO_VECTOR_IMAGE            = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#VectorImage";
const NFO_VIDEO                   = "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#Video";

const NMM_CURSOR                  = "http://www.semanticdesktop.org/ontologies/2009/02/19/nmm#Cursor";
const NMM_ICON                    = "http://www.semanticdesktop.org/ontologies/2009/02/19/nmm#Icon";
const NMM_MOVIE                   = "http://www.semanticdesktop.org/ontologies/2009/02/19/nmm#Movie";
const NMM_MUSIC_PIECE             = "http://www.semanticdesktop.org/ontologies/2009/02/19/nmm#MusicPiece";
const NMM_TV_SHOW                 = "http://www.semanticdesktop.org/ontologies/2009/02/19/nmm#TVShow";

const SIG_EVENT = '(asaasay)';
const MAX_TIMESTAMP = 9999999999999;

// Number of results given by fullTextSearch; 100 is probably enough.
// Note: We can't currently increase this number to anything above 132, due to
// https://bugs.launchpad.net/zeitgeist-extensions/+bug/716503
const MAX_RESULTS = 100;

const ResultType = {
    // http://zeitgeist-project.com/docs/0.6/datamodel.html#resulttype
    // It's unfortunate to have to define these by hand; maybe if D-Bus had a way to introspect enums...
    MOST_RECENT_EVENTS                   : 0,
    LEAST_RECENT_EVENTS                  : 1,
    MOST_RECENT_SUBJECTS                 : 2,
    LEAST_RECENT_SUBJECTS                : 3,
    MOST_POPULAR_SUBJECTS                : 4,
    LEAST_POPULAR_SUBJECTS               : 5,
    MOST_POPULAR_ACTOR                   : 6,
    LEAST_POPULAR_ACTOR                  : 7,
    MOST_RECENT_ACTOR                    : 8,
    LEAST_RECENT_ACTOR                   : 9,
    MOST_RECENT_ORIGIN                   : 10,
    LEAST_RECENT_ORIGIN                  : 11,
    MOST_POPULAR_ORIGIN                  : 12,
    LEAST_POPULAR_ORIGIN                 : 13,
    OLDEST_ACTOR                         : 14,
    MOST_RECENT_SUBJECT_INTERPRETATION   : 15,
    LEAST_RECENT_SUBJECT_INTERPRETATION  : 16,
    MOST_POPULAR_SUBJECT_INTERPRETATION  : 17,
    LEAST_POPULAR_SUBJECT_INTERPRETATION : 18,
    MOST_RECENT_MIME_TYPE                : 19,
    LEAST_RECENT_MIME_TYPE               : 20,
    MOST_POPULAR_MIME_TYPE               : 21,
    LEAST_POPULAR_MIME_TYPE              : 22
};

const StorageState = {
    // http://zeitgeist-project.com/docs/0.6/datamodel.html#storagestate
    // As with ResultType, it would be nice if we could introspect enums through D-Bus
    NOT_AVAILABLE : 0,
    AVAILABLE     : 1,
    ANY           : 2
};

// Zeitgeist D-Bus interface definitions. Note that most of these are
// incomplete, and only cover the methods/properties/signals that
// we're currently using.

const LOG_NAME = 'org.gnome.zeitgeist.Engine';
const LOG_PATH = '/org/gnome/zeitgeist/log/activity';
const LogIface = {
    name: 'org.gnome.zeitgeist.Log',
    methods: [
        { name: 'GetEvents',
          inSignature: 'au',
          outSignature: 'a'+SIG_EVENT },
        { name: 'FindRelatedUris',
          inSignature: 'au',
          outSignature: '(xx)a(' + SIG_EVENT + ')a'+ SIG_EVENT + 'uuu' },
        { name: 'FindEventIds',
          inSignature: '(xx)a' + SIG_EVENT + 'uuu',
          outSignature: 'au' },
        { name: 'FindEvents',
          inSignature: '(xx)a' + SIG_EVENT + 'uuu',
          outSignature: 'a' + SIG_EVENT },
        { name: 'InsertEvents',
          inSignature: 'a' + SIG_EVENT,
          outSignature: 'au' },
        { name: 'DeleteEvents',
          inSignature: 'au',
          outSignature: '(xx)' },
        { name: 'DeleteLog',
          inSignature: '',
          outSignature: '' },
        { name: 'Quit',
          inSignature: '',
          outSignature: '' },
        // FIXME: Add missing DBus Methods
        // - InstallMonitor
        // - RemoveMonitor
    ],
    properties: [
        { name: 'Get',
          inSignature: 'ss',
          outSignature: 'v',
          access: 'read' },
        { name: 'Set',
          inSignature: 'ssv',
          outSignature: '',
          access: 'read' },
        { name: 'GetAll',
          inSignature: 's',
          outSignature: 'a{sv}',
          access: 'read' },
    ]
};

const Log = DBus.makeProxyClass(LogIface);
const _log = new Log(DBus.session, LOG_NAME, LOG_PATH);


// Zeitgeist Full-Text-Search definitions.

const INDEX_NAME = 'org.gnome.zeitgeist.Engine';
const INDEX_PATH = '/org/gnome/zeitgeist/index/activity';
const IndexIface = {
    name: 'org.gnome.zeitgeist.Index',
    methods: [
        { name: 'Search',
          inSignature: 's(xx)a'+SIG_EVENT+'uuu',
          outSignature: 'a'+SIG_EVENT+'u' },
    ],
};

const Index = DBus.makeProxyClass(IndexIface);
const _index = new Index(DBus.session, INDEX_NAME, INDEX_PATH);


//*** JournalLayout ***
//
// This is a dumb "flow" layout - it doesn't implement behavior on its own; rather,
// it just lays out items as specified by the caller, and leaves all the behavior
// of those items up to the caller itself.
//
// JournalLayout lets you build a layout like this:
//
//    Heading2
//
//    [item]  [item]  [item]
//    [longitem]  [item]  [item]
//
//    Heading2
//
//    [item]  [item]
//
// It does this with just three methods:
//
//   - appendItem (item) - Expects an item.actor - just inserts that actor into the layout.
//
//   - appendHSpace () - Adds a horizontal space after the last item.  The amount of
//     space comes from the "item-spacing" CSS attribute within the "journal" style class.
//
//   - appendNewline () - Adds a newline after the last item, and moves the layout cursor
//     to the leftmost column in the view.  The vertical space between rows comes from
//     the "row-spacing" CSS attribute within the "journal" style class.
function SubjJournal (label, timerange, template, sorting) {
    this._init (label, timerange, template, sorting);
}

SubjJournal.prototype = {
    _init: function (label, timerange, template, sorting) {
        this._items = [];
        this._events = [];
        this._timerange = timerange;
        this._template = template;
        this._sorting = sorting;
        this._itemSpacing = 0; // "item-spacing" attribute
        this._rowSpacing = 0;  // "row-spacing" attribute
        this._container = new Shell.GenericContainer ({ style_class: 'journal' });
        this._container.connect ("style-changed", Lang.bind (this, this._styleChanged));
        this._container.connect ("allocate", Lang.bind (this, this._allocate));
        this._container.connect ("get-preferred-width", Lang.bind (this, this._getPreferredWidth));
        this._container.connect ("get-preferred-height", Lang.bind (this, this._getPreferredHeight));
        //this._container.add_actor(label.actor);
        this.actor = this._container;
        this._label = label;
        var heading = new HeadingItem(label);
        this.appendItem (heading);
        this.appendNewline();
        var heading = new HeadingItem(" ");
        this.appendItem (heading);
        this.appendNewline();
        this.actor.hide()
        findEvents (this._timerange,                           // time_range
                              [template],                                // event_templates
                              StorageState.ANY,                // storage_state - FIXME: should we use AVAILABLE instead?
                              0,                                         // num_events - 0 for "as many as you can"
                              sorting, // result_type
                              Lang.bind (this, this._appendEvents));
    },
    
    _appendEvents: function(events){
        this.actor.hide();
        this._events = events;
        var inserted = 0;
        log ("got " + events.length + " events");
        for (let i = 0; i < events.length; i++) {
            let e = events[i];
            let subject = e.subjects[0];
            let uri = subject.uri.replace('file://', '');
            uri = GLib.uri_unescape_string(uri, '');
            if (GLib.file_test(uri, GLib.FileTest.EXISTS) || subject.origin.indexOf("Telepathy") != -1) {
                if (inserted < 5) {
                    let d = new Date (e.timestamp);
                    last_timestamp = e.timestamp;
                    let item = new EventItem (e);
                    this.appendItem (item);
                    this.appendHSpace ();
                }
                inserted = inserted +1;
            }
            if (inserted > 5)
                break;
        }
        if (inserted > 0)
            this.actor.show();
        if (inserted > 5){
            // FIXME: Show a more button to expand the view
        }
        
        this.appendNewline();
        var heading = new HeadingItem(" ");
        this.appendItem (heading);
        this.appendNewline();
        var heading = new HeadingItem(" ");
        this.appendItem (heading);
   },
    
    _styleChanged: function () {
        log ("JournalLayout: _styleChanged()");
        for (var key in this._containers)
        {
            let node = this._containers[key].get_theme_node ();

            this._itemSpacing = node.get_length ("item-spacing");
            this._rowSpacing = node.get_length ("row-spacing");

            this._containers[key].queue_relayout ();
        }
    },
    
    _allocate: function (actor, box, flags) {
        let width = box.x2 - box.x1;
        this._computeLayout (width, true, flags);
    },
    
    _getPreferredWidth: function (actor, forHeight, alloc) {
        alloc.min_size = 128; // FIXME: get the icon size from CSS
        alloc.natural_size = (48 + this._itemSpacing) * 4 - this._itemSpacing; // four horizontal icons and the spacing between them
    },

    _getPreferredHeight: function (actor, forWidth, alloc) {
        let height = this._computeLayout (forWidth, true, null);
        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _computeLayout: function (available_width, do_allocation, allocate_flags) {
        let layout_state = { newline_goal_column: 0,
                             x: 0,
                             y: 0,
                             row_height : 0,
                             layout_width: available_width };

        let newline = Lang.bind (this, function () {
            layout_state.x = layout_state.newline_goal_column;
            layout_state.y += layout_state.row_height + this._rowSpacing;
            layout_state.row_height = 0;
        });

        for (let i = 0; i < this._items.length; i++) {
            let item = this._items[i];
            let item_layout = { width: 0, height: 0 };

            if (item.type == "item") {
                if (!item.child)
                    throw new Error ("internal error - item.child must not be null");

                item_layout.width = item.child.actor.get_preferred_width (-1)[1]; // [0] is minimum width; [1] is natural width
                item_layout.height = item.child.actor.get_preferred_height (item_layout.width)[1];
            } else if (item.type == "newline") {
                newline ();
                continue;
            } else if (item.type == "hspace") {
                item_layout.width = this._itemSpacing;
            }

            if (layout_state.x + item_layout.width > layout_state.layout_width) {
                newline ();

                if (item.type == "hspace")
                    continue;
            }

            let box = new Clutter.ActorBox ();
            box.x1 = layout_state.x;
            box.y1 = layout_state.y;
            box.x2 = box.x1 + item_layout.width;
            box.y2 = box.y1 + item_layout.height;

            if (item.type == "item" && do_allocation)
                item.child.actor.allocate (box, allocate_flags);

            layout_state.x += item_layout.width;
            if (item_layout.height > layout_state.row_height)
                layout_state.row_height = item_layout.height;
        }

        return layout_state.y + layout_state.row_height;
    },
    
    // We only expect items to have an item.actor field, which is a ClutterActor
    appendItem: function (item) {
        if (!item)
            throw new Error ("item must not be null");
        if (!item.actor)
            throw new Error ("Item must already contain an actor when added to the JournalLayout");
        let i = { type: "item",
                  child: item };
        this._items.push (i);
        this._container.add_actor (item.actor);
    },

    appendNewline: function () {
        let i = { type: "newline" }
        this._items.push (i);
    },

    appendHSpace: function () {
        let i = { type: "hspace" };
        this._items.push (i);
    },
}

function JournalLayout () {
    this._init ();
}

JournalLayout.prototype = {
    _init: function () {
        this._items = []; // array of { type: "item" / "newline" / "hspace", child: item }
        //this._container = new Shell.GenericContainer ({ style_class: 'journal' });

        //this._container.connect ("style-changed", Lang.bind (this, this._styleChanged));
        this._itemSpacing = 0; // "item-spacing" attribute
        this._rowSpacing = 0;  // "row-spacing" attribute

        // We pack the Shell.GenericContainer inside a box so that it will be scrollable.
        // Shell.GenericContainer doesn't implement the StScrollable interface,
        // but St.BoxLayout does.
        this._box = new St.BoxLayout({ vertical: true });
        this.actor = this._box;
        //this._container.connect ("allocate", Lang.bind (this, this._allocate));
        //this._container.connect ("get-preferred-width", Lang.bind (this, this._getPreferredWidth));
        //this._container.connect ("get-preferred-height", Lang.bind (this, this._getPreferredHeight));
    },

    _setUpTimeViews: function (timeview, category) {
        this.clear()
        var end = new Date().getTime();
        let template = category.event_template;
        let offset = category.time_range;
        let sorting = category.sorting;
        
        if (timeview == false) {
            if (offset > 0)
                start = end - offset
            else
                start = 0
            template.subjects[0].interpretation = NFO_DOCUMENT;
            this._containers = {"Documents": new SubjJournal ("Documents", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Documents"].actor, { y_align: St.Align.START, expand: true });
            
            template.subjects[0].interpretation = NFO_AUDIO;
            this._containers = {"Music": new SubjJournal ("Music", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Music"].actor, { y_align: St.Align.START, expand: true });
            
            template.subjects[0].interpretation = NFO_VIDEO;
            this._containers = {"Videos": new SubjJournal ("Videos", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Videos"].actor, { y_align: St.Align.START, expand: true });
            
            template.subjects[0].interpretation = NFO_IMAGE;
            this._containers = {"Pictures": new SubjJournal ("Pictures", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Pictures"].actor, { y_align: St.Align.START, expand: true });
            
            let subjects = []
            var interpretations = [
                '!' + NFO_IMAGE,
                '!' + NFO_DOCUMENT,
                '!' + NFO_VIDEO,
                '!' + NFO_AUDIO,
                '!' + NMM_MUSIC_PIECE];
            for (let i = 0; i < interpretations.length; i++) {
                let subject = new Subject(template.subjects[0].uri, interpretations[i], '', '', '', '', '');
                subjects.push(subject);
            }
            template = new Event("", "", "", subjects, []);
            this._containers = {"Other": new SubjJournal ("Other", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Other"].actor, { y_align: St.Align.START, expand: true });
        }
        
        else{
            var start = end - 86400000
            this._containers = {"Today": new SubjJournal ("Today", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Today"].actor, { y_align: St.Align.START, expand: true });
            
            end = start
            start = end - 86400000
            this._containers = {"Yesterday": new SubjJournal ("Yesterday", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Yesterday"].actor, { y_align: St.Align.START, expand: true });
            
            end = start
            start = end - 7 * 86400000
            this._containers = {"This Week": new SubjJournal ("This Week", [start, end], template, sorting)};
            this._box.add_actor (this._containers["This Week"].actor, { y_align: St.Align.START, expand: true });
            
            end = start
            start = end - 7 * 86400000
            this._containers = {"Last Week": new SubjJournal ("Last Week", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Last Week"].actor, { y_align: St.Align.START, expand: true });
            
            end = start
            start = end - 14 * 86400000
            this._containers = {"This Month": new SubjJournal ("This Month", [start, end], template, sorting)};
            this._box.add_actor (this._containers["This Month"].actor, { y_align: St.Align.START, expand: true });
            
            end = start
            start = 0
            this._containers = {"More Past Stuff": new SubjJournal ("More Past Stuff", [start, end], template, sorting)};
            this._box.add_actor (this._containers["More Past Stuff"].actor, { y_align: St.Align.START, expand: true });
        }
    },

    // We only expect items to have an item.actor field, which is a ClutterActor
    appendItem: function (item) {
        if (!item)
            throw new Error ("item must not be null");

        if (!item.actor)
            throw new Error ("Item must already contain an actor when added to the JournalLayout");

        let i = { type: "item",
                  child: item };

        this._items.push (i);
        this._container.add_actor (item.actor);
    },


    clear: function () {
        this._items = [];
        for (var key in this._containers)
        {
            this._containers[key].actor.destroy_children();
            this._containers[key].actor.destroy();
            this.actor.destroy_children();
        }
    },
};

/* Zeitgeist Subjects (files, people, etc.) */

function Subject(uri, interpretation, manifestation, origin, mimetype, text, storage) {
    this._init(uri, interpretation, manifestation, origin, mimetype, text, storage);
};

Subject.prototype = {
    _init: function(uri, interpretation, manifestation, origin, mimetype, text, storage) {
        this.uri = uri;
        this.interpretation = interpretation;
        this.manifestation = manifestation;
        this.origin = origin;
        this.mimetype = mimetype;
        this.text = text;
        this.storage = storage;
    },
};

Subject.fromPlain = function(rawSubject) {
    return new Subject(rawSubject[0], // uri
                       rawSubject[1], // interpretation
                       rawSubject[2], // manifestation
                       rawSubject[3], // origin
                       rawSubject[4], // mimetype
                       rawSubject[5], // text
                       rawSubject[6]); // storage
};

Subject.toPlain = function(subject) {
    let rawSubject = [];
    rawSubject[0] = subject.uri;
    rawSubject[1] = subject.interpretation;
    rawSubject[2] = subject.manifestation
    rawSubject[3] = subject.origin;
    rawSubject[4] = subject.mimetype;
    rawSubject[5] = subject.text;
    rawSubject[6] = subject.storage;
    return rawSubject;
};

/* Zeitgeist Events */

function Event(interpretation, manifestation, actor, subjects, payload) {
    this._init(interpretation, manifestation, actor, subjects, payload);
};

Event.prototype = {
    _init: function(interpretation, manifestation, actor, subjects, payload) {
        this.id = 0;
        this.timestamp = 0;
        this.actor = actor;
        this.interpretation = interpretation;
        this.manifestation = manifestation;
        this.actor = actor;
        this.payload = payload;
        this.subjects = subjects;
    },
};

Event.fromPlain = function(rawEvent) {
    let subjects = rawEvent[1].map(Subject.fromPlain);
    let event = new Event(rawEvent[0][2], // interpretation
                          rawEvent[0][3], // manifestation
                          rawEvent[0][4], // actor
                          subjects, // subjects
                          rawEvent[2]);// payload
    event.id = rawEvent[0][0]; // id
    event.timestamp = parseInt(rawEvent[0][1], 10); // timestamp - it comes as a string over d-bus (yuck)
    return event;
};

Event.toPlain = function(event) {
    let rawEvent = [];
    rawEvent[0] = [];
    rawEvent[0][0] = event.id.toString();
    rawEvent[0][1] = event.timestamp.toString();
    rawEvent[0][2] = event.interpretation;
    rawEvent[0][3] = event.manifestation;
    rawEvent[0][4] = event.actor;
    rawEvent[1] = event.subjects.map(Subject.toPlain);
    rawEvent[2] = event.payload;
    return rawEvent;
};


/* Zeitgeist D-Bus Interface */

function findEvents(timeRange, eventTemplates, storageState, numEvents, resultType, callback) {
    function handler(results, error) {
        if (error != null)
            log("Error querying Zeitgeist for events: "+error);
        else
            callback(results.map(Event.fromPlain));
    }
    _log.FindEventsRemote(timeRange, eventTemplates.map(Event.toPlain),
                          storageState, numEvents, resultType, handler);
}

/* Zeitgeist Full-Text-Search Interface */

/**
 * fullTextSearch:
 *
 * Asynchronously search Zeitgeist's index for events relating to the query.
 *
 * @param query The query string, using asterisks for wildcards. Wildcards must
 *        be used at the start and/or end of a string to get relevant information.
 * @param eventTemplates Zeitgeist event templates, see
 *        http://zeitgeist-project.com/docs/0.6/datamodel.html#event for more
 *        information
 * @param callback The callback, takes a list containing Zeitgeist.Event
 *        objects
 */
function fullTextSearch(query, eventTemplates, callback) {
    function handler(results, error) {
        if (error != null)
            log("Error searching with Zeitgeist FTS: "+error);
        else
            callback(results[0].map(Event.fromPlain));
    }
    _index.SearchRemote(query, [0, MAX_TIMESTAMP],
                        eventTemplates.map(Event.toPlain),
                        0, // offset into the search results
                        MAX_RESULTS,
                        ResultType.MOST_POPULAR_SUBJECTS, handler);
}

//*** ZeitgeistItemInfo ***


function ZeitgeistItemInfo(event) {
    this._init(event);
}

ZeitgeistItemInfo.prototype = {
    _init : function(event) {
        this.event = event;
        this.subject = event.subjects[0];
        this.timestamp = event.timestamp;
        this.name = this.subject.text;
        this._lowerName = this.name.toLowerCase();
        this.uri = this.subject.uri;
        this.mimeType = this.subject.mimetype;
        this.interpretation = this.subject.interpretation;
    },

    createIcon : function(size) {
        return St.TextureCache.get_default().load_thumbnail(size, this.uri, this.subject.mimetype);
        // FIXME: We should consider caching icons
    },

    launch : function() {
        Gio.app_info_launch_default_for_uri(this.uri,
                                            global.create_app_launch_context());
    },

    matchTerms: function(terms) {
        let mtype = Search.MatchType.NONE;
        for (let i = 0; i < terms.length; i++) {
            let term = terms[i];
            let idx = this._lowerName.indexOf(term);
            if (idx == 0) {
                mtype = Search.MatchType.PREFIX;
            } else if (idx > 0) {
                if (mtype == Search.MatchType.NONE)
                    mtype = Search.MatchType.SUBSTRING;
            } else {
                return Search.MatchType.NONE;
            }
        }
        return mtype;
    },
};


//*** EventItem ***
//
// This is an item that wraps a ZeitgeistItemInfo, which is in turn
// created from an event as returned by the Zeitgeist D-Bus API.

function EventItem (event) {
    this._init (event);
}

EventItem.prototype = {
    _init: function (event) {
        if (!event)
            throw new Error ("event must not be null");

        this._item_info = new ZeitgeistItemInfo (event);
        if (event.subjects[0].origin.indexOf("/org/freedesktop/Account/Telepathy/") != -1){
            this._icon = new IconGrid.BaseIcon (this._item_info.name,
                                            { createIcon: Lang.bind (this, function (size) {
                                                  return this._item_info.createIcon (size);
                                              })
                                            });
        }
        else{
            this._icon = new IconGrid.BaseIcon (this._item_info.name,
                                            { createIcon: Lang.bind (this, function (size) {
                                                  return this._item_info.createIcon (size);
                                              })
                                            });
        }
        this._button = new St.Button ({ style_class: "journal-item",
                                        reactive: true,
                                        button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
                                        can_focus: true,
                                        x_fill: true,
                                        y_fill: true });
        this.actor = this._button;

        this._button.set_child (this._icon.actor); 
        this._button.connect('clicked', Lang.bind(this, function() {
            this._item_info.launch();
            Main.overview.hide();
        }));
    }
};


//*** HeadingItem ***
//
// A simple label for the date block headings in the journal, i.e. the
// labels that display each day's date.

function HeadingItem (label_text) {
    this._init (label_text);
}

HeadingItem.prototype = {
    _init: function (label_text) {
        this._label_text = label_text;
        this.actor = new St.Label ({ text: label_text,
                                     style_class: 'journal-heading' });
    }
};


//*** Utility functions

function _compareEventsByTimestamp (a, b) {
    if (a.timestamp < b.timestamp)
        return -1;
    else if (b.timestamp > a.timestamp)
        return 1;
    else
        return 0;
}

//*** JournalDisplay ***
//
// This carries a JournalDisplay.actor, for a timeline view of the user's past activities.
//
// Each time the JournalDisplay's actor is mapped, the journal will reload itself
// by querying Zeitgeist for the latest events.  In effect, this means that the user
// gets an updated view every time accesses the journal from the shell.
//
// So far we don't need to install a live monitor on Zeitgeist; the assumption is that
// if you are in the shell's journal, you cannot interact with your apps anyway and 
// thus you cannot create any new Zeitgeist events just yet.

function JournalDisplay () {
    this._init ();
}

JournalDisplay.prototype = {
    _init: function () {
        this.box = new St.BoxLayout({ style_class: 'all-app' });
        this._scroll_view = new St.ScrollView ({ x_fill: true,
                                                 y_fill: true,
                             y_align: St.Align.START,
                             vfade: true });
                             
        this._scroll_view.set_policy (Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this._scroll_view.connect ("notify::mapped", Lang.bind (this, this._scrollViewMapCb));
        
        this._layout = new JournalLayout ();
        this._scroll_view.add_actor (this._layout.actor);
        
        this._filters = new St.BoxLayout({ vertical: true, reactive: true });
        this._scroll_view.add_actor(this._layout.actor, { expand: true, y_fill: true, y_align: St.Align.START });
        
        this.box.add(this._scroll_view, { expand: true, y_fill: true, y_align: St.Align.START });
        this.box.add_actor(this._filters, { expand: false, y_fill: false, y_align: St.Align.START });
        
        this.actor = this.box;
        this._sections = [];
        this._setFilters();
        this._selectCategory(1);
        //this._filters.connect('scroll-event', Lang.bind(this, this._scrollFilter))
    },
    
    _scrollFilter: function(actor, event) {
        let direction = event.get_scroll_direction();
        if (direction == Clutter.ScrollDirection.UP)
            this._selectCategory(Math.max(this._currentCategory - 1, -1))
        else if (direction == Clutter.ScrollDirection.DOWN)
            this._selectCategory(Math.min(this._currentCategory + 1, this._sections.length - 1));
    },

    _selectCategory: function(num) {
        this._currentCategory = num;

        for (let i = 0; i < this._sections.length; i++) {
            if (i == num)
                this._sections[i].add_style_pseudo_class('selected');
            else
                this._sections[i].remove_style_pseudo_class('selected');
        }
        
        var b = false
        if (num > 3) 
            b= true
        this._layout._setUpTimeViews(b, this._categories[num])
    },
    
    _setFilters: function ()
    {   
        this._counter = 0;
        this._categories = [];
        this._addCategory(new NewCategory());
        this._addCategory(new RecentCategory());
        this._addCategory(new FrequentCategory());
        this._addCategory(new StarredCategory());
        this._addCategory(new SharedCategory());
        
        var space = new St.Label ({ text: "",
                                     style_class: 'journal-heading' });
        this._filters.add(space, { expand: false, x_fill: false, y_fill: false });
        
        this._addCategory(new DocumentsCategory());
        this._addCategory(new MusicCategory());
        this._addCategory(new VideosCategory());
        this._addCategory(new PicturesCategory());
        this._addCategory(new DownloadsCategory());
        this._addCategory(new ConversationsCategory());
        this._addCategory(new MailCategory());
        this._addCategory(new OtherCategory());
    },
    
    _addCategory: function (category)
    {
        let button = new St.Button({ label: GLib.markup_escape_text (category.title, -1),
                                     style_class: 'app-filter',
                                     x_align: St.Align.START,
                                     can_focus: true });
        this._filters.add(button, { expand: false, x_fill: false, y_fill: false });
       
        this._sections[this._counter] = button;
        
        var x = this._counter;
        button.connect('clicked', Lang.bind(this, function() {
            this._selectCategory(x);
        }));
        this._categories.push(category);
        this._counter = this._counter + 1;
    },

    _scrollViewMapCb: function (actor) {
        if (this._scroll_view.mapped)
            this._reload ();
    },
    
    _reload: function () {
        this._selectCategory(this._currentCategory)
    },
};


/*****************************************************************************/


function CategoryInterface(title) {
    this._init (title);
}

CategoryInterface.prototype = {
    _init: function (title) {
        this.title = title
        this.func = null
        this.subCategories = [];
        this.event_template = null;
        this.time_range = null;
        this.sorting = 2;
    },
};


function NewCategory() {
    this._init();
}

NewCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("New"));
        let subject = new Subject ("", "", "", "", "", "", "");
        this.event_template = new Event(
            "http://www.zeitgeist-project.com/ontologies/2010/01/27/zg#CreateEvent", 
            "", "", [subject], []);
        this.time_range = 60*60*3*1000;
    },
};


function RecentCategory() {
    this._init();
}

RecentCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Recently Used"));
        let subject = new Subject ("", "", "", "", "", "", "");
        this.event_template = new Event("", "", "", [subject], []);
        this.time_range = 86400000*2;
    },
};


function FrequentCategory() {
    this._init();
}

FrequentCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Frequent"));
        let subject = new Subject ("", "", "", "", "", "", "");
        this.event_template = new Event("", "", "", [subject], []);
        this.time_range = 4*86400000;
        this.sorting = 4;
    },
};


function StarredCategory() {
    this._init();
}

StarredCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Starred"));
        let subject = new Subject ("bookmark://", "", "", "", "", "", "");
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function SharedCategory() {
    this._init();
}

SharedCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Shared"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.uri = "file://"+GLib.get_user_special_dir(5)+"/*";
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function DocumentsCategory() {
    this._init();
}

DocumentsCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Documents"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.interpretation = NFO_DOCUMENT;
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function MusicCategory() {
    this._init();
}

MusicCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Audio"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.interpretation = NFO_AUDIO;
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function VideosCategory() {
    this._init();
}

VideosCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Videos"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.interpretation = NFO_VIDEO;
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function PicturesCategory() {
    this._init();
}

PicturesCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Pictures"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.interpretation = NFO_IMAGE;
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function DownloadsCategory() {
    this._init();
}

DownloadsCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Downloads"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.uri = "file://"+GLib.get_user_special_dir(2)+"/*";
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function ConversationsCategory() {
    this._init();
}

ConversationsCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Conversations"));
        let subject = new Subject ("", "", "", "", "", "", "");
        subject.origin = "/org/freedesktop/Telepathy/Account/*"
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function MailCategory() {
    this._init();
}

MailCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Mail Attachments"));
        let subject = new Subject ("", "000", "", "", "", "", "");
        this.event_template =  new Event("", "", "", [subject], []);
        this.time_range = -1;
    },
};


function OtherCategory() {
    this._init();
}

OtherCategory.prototype = {
    __proto__: CategoryInterface.prototype,
    _init: function() {
        CategoryInterface.prototype._init.call(this, _("Other"));
        let subjects = []
        var interpretations = [
            '!' + NFO_IMAGE,
            '!' + NFO_DOCUMENT,
            '!' + NFO_VIDEO,
            '!' + NFO_AUDIO,
            '!' + NMM_MUSIC_PIECE];
        for (let i = 0; i < interpretations.length; i++) {
            let subject = new Subject('', interpretations[i], '', '', '', '', '');
            subjects.push(subject);
        }
        this.event_template =  new Event("", "", "", subjects, []);
        this.time_range = -1;
    },
};

function main(metadata) {
	imports.gettext.bindtextdomain('gnome-shell-extensions', metadata.localedir);
	let journalView = new JournalDisplay();
	Main.overview.viewSelector.addViewTab('journal', _("Library"), journalView.actor, 'history');
}
