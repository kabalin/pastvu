/*global requirejs:true, require:true, define:true*/
/**
 * Модель фотографий пользователя
 */
define(['underscore', 'Browser', 'Utils', 'socket', 'Params', 'knockout', 'knockout.mapping', 'm/_moduleCliche', 'globalVM', 'renderer', 'm/Photo', 'm/storage', 'text!tpl/user/gallery.jade', 'css!style/user/gallery'], function (_, Browser, Utils, socket, P, ko, ko_mapping, Cliche, globalVM, renderer, Photo, storage, jade) {
    'use strict';
    var $window = $(window);

    return Cliche.extend({
        jade: jade,
        options: {
            canAdd: false
        },
        create: function () {
            this.auth = globalVM.repository['m/auth'];
            this.u = null;
            this.photos = ko.observableArray();
            this.uploadVM = null;
            this.limit = 42; //Стараемся подобрать кол-во, чтобы выводилось по-строчного. Самое популярное - 6 на строку
            this.loadingPhoto = ko.observable(false);
            this.scrollActive = false;
            this.scrollHandler = function () {
                if ($window.scrollTop() >= $(document).height() - $window.height() - 50) {
                    this.getNextPage();
                }
            }.bind(this);
            this.width = ko.observable('0px');
            this.height = ko.observable('0px');
            P.window.square.subscribe(this.sizesCalc, this);

            P.settings.LoggedIn.subscribe(this.loginHandler, this);

            var user = globalVM.router.params().user || this.auth.iAm.login();

            storage.user(user, function (data) {
                if (data) {
                    this.u = data.vm;
                    this.canAdd = ko.computed(function () {
                        return this.options.canAdd && this.u.login() === this.auth.iAm.login();
                    }, this);
                    ko.applyBindings(globalVM, this.$dom[0]);
                    this.show();
                }
            }, this);
        },
        show: function () {
            this.$container.fadeIn(function () {
                //this.sizesCalc(P.window.square());
            }.bind(this));
            this.sizesCalc(P.window.square());
            if (this.u.pcount() > 0) {
                this.getPage(0, this.canAdd() ? this.limit - 1 : this.limit);
                $window.on('scroll', this.scrollHandler);
                this.scrollActive = true;
            }
            this.showing = true;
        },
        hide: function () {
            if (this.scrollActive) {
                $window.off('scroll', this.scrollHandler);
                this.scrollActive = false;
            }
            this.$container.css('display', '');
            this.showing = false;
        },

        loginHandler: function (v) {
            // После логина/логаута перезапрашиваем ленту фотографий пользователя
            if (this.u.pcount() > 0) {
                this.getPhotosPrivate(function (data) {
                    if (data && !data.error && data.length > 0 && this.photos().length < this.limit * 1.5) {
                        this.getNextPage();
                    }
                }, this);
            }
        },

        getPhotos: function (start, limit, cb, ctx) {
            socket.once('takeUserPhotos', function (data) {
                if (!data || data.error) {
                    window.noty({text: data.message || 'Error occurred', type: 'error', layout: 'center', timeout: 3000, force: true});
                } else {
                    data.forEach(function (item, index, array) {
                        item = _.defaults(item, Photo.defCompact);
                        item.loaded = new Date(item.loaded);
                        item.pfile = '/_photo/thumb/' + item.file;
                    });
                }
                if (Utils.isObjectType('function', cb)) {
                    cb.call(ctx, data);
                }
                this.loadingPhoto(false);
            }.bind(this));
            socket.emit('giveUserPhotos', {login: this.u.login(), start: start, limit: limit});
            this.loadingPhoto(true);
        },
        getPage: function (start, limit) {
            this.getPhotos(start, limit, function (data) {
                if (!data || data.error) {
                    return;
                }
                this.photos.concat(data, false);
                if (this.scrollActive && this.photos().length >= this.u.pcount()) {
                    $window.off('scroll', this.scrollHandler);
                    this.scrollActive = false;
                }
            }, this);
        },
        getNextPage: function () {
            if (!this.loadingPhoto()) {
                this.getPage(this.photos().length, this.limit);
            }
        },
        getPhotosPrivate: function (cb, ctx) {
            if (this.photos().length === 0) {
                return;
            }
            socket.once('takeUserPhotosPrivate', function (data) {
                if (!data || data.error || data.length === 0) {
                    //window.noty({text: data.message || 'Error occurred', type: 'error', layout: 'center', timeout: 3000, force: true});
                } else {
                    var currArray = this.photos();

                    data.forEach(function (item, index, array) {
                        item = _.defaults(item, Photo.defCompact);
                        item.loaded = new Date(item.loaded);
                        item.pfile = '/_photo/thumb/' + item.file;
                    });

                    Array.prototype.push.apply(currArray, data);

                    currArray.sort(function (a, b) {
                        if (a.loaded < b.loaded) {
                            return 1;
                        } else if (a.loaded > b.loaded) {
                            return -1;
                        } else {
                            return 0;
                        }
                    });

                    this.photos(currArray);
                    currArray = null;
                }
                this.loadingPhoto(false);
                if (Utils.isObjectType('function', cb)) {
                    cb.call(ctx, data);
                }
            }.bind(this));
            socket.emit('giveUserPhotosPrivate', {login: this.u.login(), startTime: _.last(this.photos()).loaded, endTime: undefined});
            this.loadingPhoto(true);
        },
        onThumbLoad: function (data, event) {
            $(event.target).parents('.photoThumb').animate({opacity: 1});
            data = event = null;
        },
        onThumbError: function (data, event) {
            var $parent = $(event.target).parents('.photoThumb');
            event.target.style.visibility = 'hidden';
            if (data.conv) {
                $parent.addClass('photoConv');
            } else if (data.convqueue) {
                $parent.addClass('photoConvqueue');
            } else {
                $parent.addClass('photoError');
            }
            $parent.animate({opacity: 1});
            data = event = $parent = null;
        },
        sizesCalc: function (v) {
            var windowW = P.window.w(),
                domW = this.$dom.width() - 1, //this.$container.width()
                thumbW,
                thumbH,
                thumbN,
                thumbWMin = 120,
                thumbWMax = 246,
                marginMin;

            //Так как в @media firefox считает ширину с учетом ширины скролла,
            //то прибавляем эту ширину и здесь для правильного подсчета маргинов
            if ($.browser.mozilla) {
                windowW += window.innerWidth - windowW;
            }

            if (windowW < 1000) {
                thumbN = 4;
                marginMin = 8;
            } else if (windowW < 1366) {
                thumbN = 5;
                marginMin = 10;
            } else {
                thumbN = 6;
                marginMin = 14;
            }
            thumbW = Math.max(thumbWMin, Math.min(domW / thumbN - marginMin - 2, thumbWMax));
            thumbH = thumbW / 1.5 >> 0;
            thumbW = thumbH * 1.5;

            //margin = ((domW % thumbW) / (domW / thumbW >> 0)) / 2 >> 0;

            this.width(thumbW + 'px');
            this.height(thumbH + 'px');

            windowW = domW = thumbW = thumbH = null;
        },
        showUpload: function (data, event) {
            this.$dom.find('span.modalCaption').text('Upload photo');
            $('.photoUploadCurtain').fadeIn(400, function () {
                renderer(
                    [
                        {module: 'm/user/photoUpload', container: '.modalContainer', options: {popup: true}, callback: function (vm) {
                            this.uploadVM = vm;
                        }.bind(this)}
                    ],
                    {
                        parent: this,
                        level: this.level + 1
                    }
                );
            }.bind(this));
            if (event.stopPropagation) {
                event.stopPropagation();
            }
            return false;
        },
        closeUpload: function (data, event) {
            $('.photoUploadCurtain').fadeOut(400, function () {
                this.uploadVM.destroy();
                var oldFirst = this.photos()[0] ? this.photos()[0].file : 0;
                this.getPhotos(0, 11, function (data) {
                    if (!data || data.error) {
                        return;
                    }
                    if (oldFirst === 0) {
                        this.photos.concat(data, false);
                    } else {
                        var intersectionIndex = data.reduce(function (previousValue, currentValue, index, array) {
                            if (previousValue === 0 && currentValue.file === oldFirst) {
                                return index;
                            } else {
                                return previousValue;
                            }
                        }.bind(this), 0);
                        if (intersectionIndex > 0) {
                            this.photos.concat(data.slice(0, intersectionIndex), true);
                        }
                    }

                }, this);
            }.bind(this));
        }
    });
});