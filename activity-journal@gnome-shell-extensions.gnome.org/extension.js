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
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext.domain('gnome-shell');
const _ = Gettext.gettext;
const C_ = Gettext.pgettext;

const IconGrid = imports.ui.iconGrid;
const Zeitgeist = imports.misc.zeitgeist;
const DocInfo = imports.misc.docInfo;
const Semantic = imports.misc.semantic;


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
        Zeitgeist.findEvents (this._timerange,                        // time_range
                              [template],                                   // event_templates
                              Zeitgeist.StorageState.ANY,                // storage_state - FIXME: should we use AVAILABLE instead?
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
            template.subjects[0].interpretation = Semantic.NFO_DOCUMENT;
            this._containers = {"Documents": new SubjJournal ("Documents", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Documents"].actor, { y_align: St.Align.START, expand: true });
            
            template.subjects[0].interpretation = Semantic.NFO_AUDIO;
            this._containers = {"Music": new SubjJournal ("Music", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Music"].actor, { y_align: St.Align.START, expand: true });
            
            template.subjects[0].interpretation = Semantic.NFO_VIDEO;
            this._containers = {"Videos": new SubjJournal ("Videos", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Videos"].actor, { y_align: St.Align.START, expand: true });
            
            template.subjects[0].interpretation = Semantic.NFO_IMAGE;
            this._containers = {"Pictures": new SubjJournal ("Pictures", [start, end], template, sorting)};
            this._box.add_actor (this._containers["Pictures"].actor, { y_align: St.Align.START, expand: true });
            
            let subjects = []
            var interpretations = [
                '!' + Semantic.NFO_IMAGE,
                '!' + Semantic.NFO_DOCUMENT,
                '!' + Semantic.NFO_VIDEO,
                '!' + Semantic.NFO_AUDIO,
                '!' + Semantic.NMM_MUSIC_PIECE];
            for (let i = 0; i < interpretations.length; i++) {
                let subject = new Zeitgeist.Subject(template.subjects[0].uri, interpretations[i], '', '', '', '', '');
                subjects.push(subject);
            }
            template = new Zeitgeist.Event("", "", "", subjects, []);
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

        this._item_info = new DocInfo.ZeitgeistItemInfo (event);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        this.event_template = new Zeitgeist.Event(
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        this.event_template = new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        this.event_template = new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("bookmark://", "", "", "", "", "", "");
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.uri = "file://"+GLib.get_user_special_dir(5)+"/*";
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.interpretation = Semantic.NFO_DOCUMENT;
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.interpretation = Semantic.NFO_AUDIO;
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.interpretation = Semantic.NFO_VIDEO;
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.interpretation = Semantic.NFO_IMAGE;
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.uri = "file://"+GLib.get_user_special_dir(2)+"/*";
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "", "", "", "", "", "");
        subject.origin = "/org/freedesktop/Telepathy/Account/*"
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
        let subject = new Zeitgeist.Subject ("", "000", "", "", "", "", "");
        this.event_template =  new Zeitgeist.Event("", "", "", [subject], []);
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
            '!' + Semantic.NFO_IMAGE,
            '!' + Semantic.NFO_DOCUMENT,
            '!' + Semantic.NFO_VIDEO,
            '!' + Semantic.NFO_AUDIO,
            '!' + Semantic.NMM_MUSIC_PIECE];
        for (let i = 0; i < interpretations.length; i++) {
            let subject = new Zeitgeist.Subject('', interpretations[i], '', '', '', '', '');
            subjects.push(subject);
        }
        this.event_template =  new Zeitgeist.Event("", "", "", subjects, []);
        this.time_range = -1;
    },
};

function main(metadata) {
	imports.gettext.bindtextdomain('gnome-shell-extensions', metadata.localedir);
	let journalView = new JournalDisplay();
	Main.overview.viewSelector.addViewTab('journal', _("Library"), journalView.actor, 'history');
}
